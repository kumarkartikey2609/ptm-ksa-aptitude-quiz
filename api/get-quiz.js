const { QUESTIONS } = require("./_shared/questions.js");

// Every fine-grained question category maps to one of 5 scoring "buckets".
// This keeps the existing category detail (Safety, Time, Attitude, Teamwork,
// Lifestyle, etc.) intact for reporting, while the quiz itself is drawn as a
// fixed quota across those 5 buckets, out of every 20 questions:
//   Skill                  -> 7  (35%)
//   Intent / Professionalism -> 7  (35%)
//   Communication           -> 2  (10%)
//   Honesty                 -> 2  (10%)
//   Situation Handling      -> 2  (10%)
const BUCKET_MAP = {
  Skill: "Skill",
  Safety: "Skill",
  Intent: "IntentProfessionalism",
  Professionalism: "IntentProfessionalism",
  Time: "IntentProfessionalism",
  Attitude: "IntentProfessionalism",
  Teamwork: "IntentProfessionalism",
  Lifestyle: "IntentProfessionalism",
  Communication: "Communication",
  Honesty: "Honesty",
  SituationHandling: "SituationHandling",
};

const QUOTA = {
  Skill: 7,
  IntentProfessionalism: 7,
  Communication: 2,
  Honesty: 2,
  SituationHandling: 2,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Group the full question bank into the 5 buckets once (module load time).
const byBucket = {};
for (const q of QUESTIONS) {
  const bucket = BUCKET_MAP[q.cat];
  if (!bucket) continue; // defensive: an unmapped category is simply never drawn
  if (!byBucket[bucket]) byBucket[bucket] = [];
  byBucket[bucket].push(q);
}

module.exports = (req, res) => {
  let picked = [];
  for (const bucket of Object.keys(QUOTA)) {
    const need = QUOTA[bucket];
    const available = byBucket[bucket] || [];
    const chosen = shuffle(available).slice(0, need);
    if (chosen.length < need) {
      // Defensive fallback: if a bucket somehow doesn't have enough
      // questions, log it but don't fail the whole request.
      console.error(`get-quiz: bucket "${bucket}" only has ${chosen.length}/${need} questions available`);
    }
    picked = picked.concat(chosen);
  }

  picked = shuffle(picked); // mix the section order so candidates can't tell which part of the quiz they're in

  const quiz = picked.map((item) => ({
    id: item.id,
    q: item.q,
    opts: shuffle(item.opts),
  }));

  res.setHeader("content-type", "application/json");
  res.status(200).json({
    setId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    questions: quiz,
  });
};
