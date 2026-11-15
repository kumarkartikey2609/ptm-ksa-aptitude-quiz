const { QUESTIONS, SETS } = require("./_shared/questions.js");
const { logStart } = require("./_shared/sheets.js");

// Each test is one of 20 fixed sets (see SETS in questions.js). Every set has
// 20 different questions with the same mix:
//   50%  Skill and time   (10: area cleaning, SOP, time management, skills/safety)
//   20%  Intent           (4)
//   20%  Situations       (4)
//   10%  Behaviour        (2)
// Candidate number N (counted from the "Started" tab) gets set N % 20, so the
// first 20 candidates never see the same set.

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = async (req, res) => {
  const query = req.query || {};
  const name = String(query.name || "").trim().slice(0, 200);
  const agency = String(query.agency || "").trim().slice(0, 200);
  const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Log the start in the "Started" tab (also gives us the candidate number).
  // If the Sheet is down we still serve a random set, so the test never blocks.
  let setIndex = Math.floor(Math.random() * SETS.length);
  try {
    const n = await logStart({ name, agency, testId, setCount: SETS.length });
    if (n && typeof n.setIndex === "number") setIndex = n.setIndex;
  } catch (e) {
    console.error("get-quiz: could not log start:", String(e));
  }

  const ids = SETS[setIndex % SETS.length];
  const picked = shuffle(ids.map((id) => byId.get(id)).filter(Boolean));

  const quiz = picked.map((item) => ({
    id: item.id,
    q: item.q,
    opts: shuffle(item.opts),
  }));

  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    setId: testId,
    setNo: (setIndex % SETS.length) + 1,
    questions: quiz,
  });
};
