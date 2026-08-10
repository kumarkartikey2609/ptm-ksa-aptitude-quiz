const { QUESTIONS } = require("./_shared/questions.js");

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = (req, res) => {
  const pool = shuffle(QUESTIONS);
  const picked = pool.slice(0, 20);

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
