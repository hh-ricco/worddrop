const WordEngine = (() => {
  let words    = [];   /* full word list for current pack */
  let progress = {};
  let turn     = 0;
  let recentIds = [];  /* last 3 word ids to avoid repeats */

  /* In-session miss re-queue: [{ word, dueAt }], dueAt = selectCount when it should appear */
  let missedQueue = [];
  let selectCount = 0;
  const MISS_REQUEUE_DELAY = 2;  /* appear N selections after miss */

  function init(wordList, progressData, currentTurn) {
    words    = wordList;
    progress = progressData;
    turn     = currentTurn;
    recentIds = [];
    missedQueue = [];
    selectCount = 0;
  }

  /* ── Select next word ──────────────────────── */
  function selectNext() {
    if (words.length === 0) return null;
    selectCount++;

    /* 0. Re-queued missed word whose delay has elapsed */
    const idx = missedQueue.findIndex(m => m.dueAt <= selectCount);
    if (idx >= 0) {
      const { word } = missedQueue.splice(idx, 1)[0];
      _track(word.id);
      return word;
    }

    /* 1. Words overdue for review */
    const due = words
      .filter(w => {
        const r = Records.getRecord(progress, w.packId, w.word);
        return r.nextDue <= turn && !recentIds.includes(w.id);
      })
      .sort((a, b) => {
        const ra = Records.getRecord(progress, a.packId, a.word);
        const rb = Records.getRecord(progress, b.packId, b.word);
        return (ra.nextDue - rb.nextDue) || (ra.easeFactor - rb.easeFactor);
      });

    if (due.length > 0) {
      _track(due[0].id);
      return due[0];
    }

    /* 2. Weighted random from remaining words */
    const pool = words.filter(w => !recentIds.includes(w.id));
    const source = pool.length > 0 ? pool : words;
    const weights = source.map(w => {
      const r = Records.getRecord(progress, w.packId, w.word);
      return 1 / (r.easeFactor * Math.max(1, r.interval));
    });
    const chosen = _weightedRandom(source, weights);
    _track(chosen.id);
    return chosen;
  }

  function _track(id) {
    recentIds.push(id);
    if (recentIds.length > 3) recentIds.shift();
  }

  function _weightedRandom(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let rand = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      rand -= weights[i];
      if (rand <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /* ── Re-queue a missed word for in-session retry ── */
  function requeueMissed(wordObj) {
    missedQueue.push({ word: wordObj, dueAt: selectCount + MISS_REQUEUE_DELAY });
  }

  /* ── Record result and advance turn ───────── */
  function recordResult(wordObj, errorCount, success) {
    let q;
    if (!success)          q = errorCount > 3 ? 0 : 1;
    else if (errorCount === 0) q = 5;
    else if (errorCount <= 2)  q = 4;
    else                   q = 3;

    const rec = Records.getRecord(progress, wordObj.packId, wordObj.word);
    rec.letterErrors = (rec.letterErrors || 0) + errorCount;
    Records.updateRecord(progress, rec, q, turn);
    turn = Records.incrementTurn();
  }

  function getProgress() { return progress; }

  return { init, selectNext, recordResult, requeueMissed, getProgress };
})();
