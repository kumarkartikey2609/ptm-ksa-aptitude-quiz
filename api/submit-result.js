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
 
  const name = String(body.name || "").trim().slice(0, 200);
  const dob = String(body.dob || "").trim().slice(0, 50);
  const interviewCity = String(body.interviewCity || "").trim().slice(0, 100);
  const passport = String(body.passport || "").trim().slice(0, 100);
  const region = String(body.region || "").trim().slice(0, 150);
  const setId = String(body.setId || "").slice(0, 50);
  const answers = Array.isArray(body.answers) ? body.answers : [];
 
  if (!name || !dob || !interviewCity || !region || answers.length === 0) {
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
  const submittedAt = new Date().toISOString();
 
  // Write to Google Sheet immediately (synchronously, within this request).
  // Best-effort: a Sheets failure should not block the candidate's result.
  try {
    await appendRow([
      submittedAt,
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
    "**Name:** " + name,
    "**Date of Birth:** " + dob,
    "**Interview City:** " + interviewCity,
    "**Passport Number:** " + (passport || "-"),
    "**Province/City/Region:** " + region,
    "**Question Set ID:** " + setId,
    "**Score:** " + score + " / " + total + " (" + percentage + "%)",
    "**Result:** " + result,
    "**Submitted:** " + submittedAt,
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
