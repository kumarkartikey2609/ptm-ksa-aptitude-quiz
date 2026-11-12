const { QUESTIONS } = require("./_shared/questions.js");
const { appendRow } = require("./_shared/sheets.js");

const PASS_THRESHOLD = 75; // at least 15 of 20 questions must be correct

// Returns height in centimetres, or null if it cannot be read with confidence.
// Accepts: "165", "165 cm", "1.65 m", "1.65", "5 ft 4 in", "5ft4", "5'4", "5'4\"", "5 feet", "5 feet 4 inches".
// A bare number between 3 and 8 (like "5.4") is rejected on purpose: it could be 5.4 ft or 5 ft 4 in.
function parseHeightCm(raw) {
  let s = String(raw || "").toLowerCase().trim();
  if (!s) return null;
  s = s.replace(/[‘’′`´]/g, "'").replace(/[“”″]/g, '"');
  s = s.replace(/''/g, '"').replace(/\./g, (m, i, str) => (/\d/.test(str[i - 1] || "") && /\d/.test(str[i + 1] || "") ? "." : " "));
  s = s.replace(/\s+/g, " ").trim();
  let cm = null, m;

  // centimetres: "165", "165 cm", "165 centimeters"
  if ((m = s.match(/^(\d{2,3}(?:\.\d+)?)\s*(?:cm|cms|centimet(?:er|re)s?)?$/))) {
    cm = parseFloat(m[1]);
  }
  // metres: "1.65 m", "1.65 meters", or a bare decimal like "1.65"
  else if ((m = s.match(/^(\d(?:\.\d+)?)\s*(?:m|mt|mts|met(?:er|re)s?)$/)) || (m = s.match(/^([12]\.\d+)$/))) {
    cm = parseFloat(m[1]) * 100;
  }
  // feet and inches: "5 ft 4 in", "5ft4", "5'4", "5'4\"", "5 feet", "5 feet 4 inches"
  else if ((m = s.match(/^(\d)\s*(?:ft|feet|foot|')\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:in|ins|inch|inches|")?)?$/))) {
    const ft = parseFloat(m[1]);
    const inch = m[2] ? parseFloat(m[2]) : 0;
    if (inch >= 12) return null;
    cm = ft * 30.48 + inch * 2.54;
  }
  if (cm === null || !(cm >= 100 && cm <= 250)) return null;
  return Math.round(cm * 10) / 10;
}

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
  // Height (free text: "165 cm" or "5 ft 4 in") and weight (kg). Not enforced
  // server-side so a candidate with an old, already-open page can still submit.
  const height = String(body.height || "").trim().slice(0, 50);
  const weight = String(body.weight || "").trim().slice(0, 20);
  // BMI = kg / (metres squared), 1 decimal. Left blank if height/weight can't be read.
  const heightCm = parseHeightCm(height);
  const weightKg = parseFloat(weight);
  const bmi =
    heightCm && weightKg >= 20 && weightKg <= 250
      ? Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10
      : "";
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
  // Per-question detail (question text, what the candidate picked, whether it
  // was correct) — kept in the order the candidate answered them, so we can
  // include a full answer breakdown in the GitHub Issue for internal review.
  const breakdown = [];
  for (const a of answers) {
    const q = byId.get(a.id);
    if (!q || seen.has(a.id)) continue;
    seen.add(a.id);
    total += 1;
    const correctText = q.opts[q.correct];
    const selectedText = String(a.selected || "");
    const isCorrect = selectedText === correctText;
    if (isCorrect) score += 1;
    breakdown.push({
      questionText: q.q,
      category: q.cat,
      selected: selectedText || "(no answer)",
      correctText,
      isCorrect,
    });
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
  // NOTE: the Sheet intentionally stays a clean, scannable summary — it does
  // NOT get the per-question answer breakdown. That level of detail goes to
  // the GitHub Issue body instead (see below), which is the place to review
  // exactly what a candidate answered.
  let sheetOk = false;
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
      experience, // column N — Past Working Experience
      education, // column O — Educational Background
      "", // column P — intentionally blank (no header)
      ksaTime, // column Q — submission time in KSA local time
      height, // column R — Height (cm / feet)
      weight, // column S — Weight (kg)
      bmi, // column T — BMI (calculated)
    ]);
    sheetOk = true;
  } catch (e) {
    console.error("Sheets append failed:", e);
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  const passLabel = result === "PASS" ? "pass" : "fail";
  const title = name + " — " + result + " (" + score + "/" + total + ")";

  const breakdownLines = breakdown.map((b, i) => {
    const mark = b.isCorrect ? "✅" : "❌";
    let line =
      mark + " **Q" + (i + 1) + ". [" + b.category + "]** " + b.questionText + "\n" +
      "   Selected: " + b.selected;
    if (!b.isCorrect) {
      line += "\n   Correct answer: " + b.correctText;
    }
    return line;
  });

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
    "**Height:** " + (height || "-"),
    "**Weight (kg):** " + (weight || "-"),
    "**BMI:** " + (bmi === "" ? "-" : bmi),
    "**Question Set ID:** " + setId,
    "**Score:** " + score + " / " + total + " (" + percentage + "%)",
    "**Result:** " + result,
    "**Submitted:** " + ksaDate + " " + ksaTime + " (KSA time)",
    "",
    "---",
    "",
    "### Answer Breakdown",
    "",
    breakdownLines.join("\n\n"),
  ].join("\n");

  // GitHub Issue (answer breakdown) is best-effort too. If the Sheet row was
  // saved, a GitHub problem (expired token, rate limit, outage) must NOT make
  // the candidate see an error — and retrying would only create a duplicate
  // Sheet row. We only return an error if NEITHER place saved the result.
  let githubOk = false;
  let githubError = "";
  if (!token || !owner || !repo) {
    githubError = "GitHub env vars not configured";
  } else {
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
      if (ghRes.ok) {
        githubOk = true;
      } else {
        githubError = "GitHub " + ghRes.status + ": " + (await ghRes.text());
      }
    } catch (e) {
      githubError = "GitHub request failed: " + String(e);
    }
  }

  if (!githubOk) {
    // Shows up in Vercel > Logs so a broken token is noticed quickly.
    console.error("GitHub issue NOT created for " + name + " (" + result + " " + score + "/" + total + "): " + githubError);
  }

  if (!sheetOk && !githubOk) {
    res.status(502).json({ error: "Could not save result", detail: githubError });
    return;
  }

  res.status(200).json({ score, total, percentage, result });
};
