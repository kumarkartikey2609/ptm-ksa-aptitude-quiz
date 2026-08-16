const { QUESTIONS } = require("./_shared/questions.js");
const { appendRow } = require("./_shared/sheets.js");

const PASS_THRESHOLD = 60; // at least 12 of 20 questions must be correct

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const agencyName = String(body.agencyName || "").trim().slice(0, 200);
  const interviewDate = String(body.interviewDate || "").trim().slice(0, 50);
  const name = String(body.name || "").trim().slice(0, 200);
  const dob = String(body.dob || "").trim().slice(0, 50);
  const interviewCity = String(body.interviewCity || "").trim().slice(0, 100);
  const passport = String(body.passport || "").trim().slice(0, 100);
  const region = String(body.region || "").trim().slice(0, 150);
  const experience = String(body.experience || "").trim().slice(0, 2000);
  const education = String(body.education || "").trim().slice(0, 1000);
  const setId = String(body.setId || "").slice(0, 50);
  const answers = Array.isArray(body.answers) ? body.answers : [];

  if (!agencyName || !interviewDate || !name || !dob || !interviewCity || !region || !experience || !education || answers.length === 0) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
  let score = 0;
  let total = 0;
  const seen = new Set();
  for (const a of answers) {
    const q = byId.get(a.id);
    if (!q || seen.has(a.id)) continue;
    seen.add(a.id);
    total += 1;
    const correctText = q.opts[q.correct];
    if (a.selected === correctText) score += 1;
  }

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const result = percentage >= PASS_THRESHOLD ? "PASS" : "FAIL";
  const now = new Date();
  const submittedAt = now.toISOString();

  // Record the submission date/time in KSA local time (Asia/Riyadh, UTC+3),
  // not raw UTC — this is what actually gets written into the Sheet.
  const ksaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // e.g. "2026-08-16"
  const ksaTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now); // e.g. "19:42:05"

  // Write to Google Sheet immediately (synchronously, within this request).
  // Best-effort: a Sheets failure should not block the candidate's result.
  try {
    await appendRow([
      ksaDate,
      name,
      dob,
      interviewCity,
      passport,
      region,
      setId,
      score,
      total,
      percentage,
      result,
      agencyName,
      interviewDate,
      "", // column N is already in use by another process on this sheet — leave blank
      experience,
      education,
      ksaTime, // column Q — submission time in KSA local time
    ]);
  } catch (e) {
    console.error("Sheets append failed:", e);
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const passLabel = result === "PASS" ? "pass" : "fail";
  const title = name + " — " + result + " (" + score + "/" + total + ")";
  const issueBody = [
    "**Agency Name:** " + agencyName,
    "**Interview Date:** " + interviewDate,
    "**Name:** " + name,
    "**Date of Birth:** " + dob,
    "**Interview City:** " + interviewCity,
    "**Passport Number:** " + (passport || "-"),
    "**Province/City/Region:** " + region,
    "**Past Working Experience:** " + experience,
    "**Educational Background:** " + education,
    "**Question Set ID:** " + setId,
    "**Score:** " + score + " / " + total + " (" + percentage + "%)",
    "**Result:** " + result,
    "**Submitted:** " + ksaDate + " " + ksaTime + " (KSA time)",
  ].join("\n");

  try {
    const ghRes = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/issues", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "ptm-ksa-aptitude-quiz",
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: [passLabel],
      }),
    });

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      res.status(502).json({ error: "GitHub error", detail: errText });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: "GitHub request failed", detail: String(e) });
    return;
  }

  res.status(200).json({ score, total, percentage, result });
};
