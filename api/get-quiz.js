const { QUESTIONS } = require("./_shared/questions.js");

// Every fine-grained question category maps to one of 4 topic "buckets".
// This keeps the category detail (Safety, Time, Honesty, etc.) for reporting,
// while each test is drawn as a fixed quota per bucket, out of 20 questions:
//   Cleaning (skills, area-wise cleaning, SOP, safety)  -> 8  (40%)
//   Customer handling                                   -> 4  (20%)
//   Situations on the job (incl. honesty)               -> 4  (20%)
//   Intent and time management                          -> 4  (20%)
const BUCKET_MAP = {
  Skill: "Cleaning",
  Safety: "Cleaning",
  Area: "Cleaning",
  SOP: "Cleaning",
  Customer: "Customer",
  Communication: "Customer",
  Professionalism: "Customer",
  SituationHandling: "Situation",
  Honesty: "Situation",
  Intent: "IntentTime",
  Time: "IntentTime",
  Attitude: "IntentTime",
  Teamwork: "IntentTime",
  Lifestyle: "IntentTime",
};

const QUOTA = {
  Cleaning: 8,
  Customer: 4,
  Situation: 4,
  IntentTime: 4,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Group the full question bank into the 4 buckets once (module load time).
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
