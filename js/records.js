const Records = (() => {
  const KEY_SESSIONS   = 'wordgame_sessions';
  const KEY_PROGRESS   = 'wordgame_progress';
  const KEY_SETTINGS   = 'wordgame_settings';
  const KEY_CUSTOM     = 'wordgame_custom_packs';
  const KEY_TURN       = 'wordgame_turn';
  const KEY_BOOK_PROG  = 'wordgame_book_progress';   /* per-book reading progress */
  const KEY_LAST_MODE  = 'wordgame_last_mode';        /* {mode, detail, at} for home-screen "resume" */

  /* ── Settings ──────────────────────────────── */
  const DEFAULT_SETTINGS = {
    translationLang: 'zh',
    showHints:       true,
    showKeyboard:    true,
    ttsEnabled:      true,
    accent:          'us',     /* 'us' = American English, 'gb' = British English */
    spellOnMiss:     true,     /* spell word letter-by-letter when missed */
    ttsSpeed:        0.85,
    sfxEnabled:      true,
    bgmEnabled:      false,
    volume:          0.8,
    speed:           'normal',
    theme:           'dark',
    giphyKey:        '',
  };

  function loadSettings() {
    try {
      const saved = localStorage.getItem(KEY_SETTINGS);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings(s) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  }

  /* ── SM-2 Progress ─────────────────────────── */
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(KEY_PROGRESS) || '{}');
    } catch { return {}; }
  }

  function saveProgress(p) {
    localStorage.setItem(KEY_PROGRESS, JSON.stringify(p));
  }

  function getRecord(progress, packId, wordId) {
    const key = `${packId}::${wordId}`;
    return progress[key] || {
      wordId, packId,
      attempts: 0, successes: 0, failures: 0, letterErrors: 0,
      lastSeen: 0, interval: 1, easeFactor: 2.5, nextDue: 0
    };
  }

  function updateRecord(progress, rec, quality, currentTurn) {
    rec.attempts++;
    rec.lastSeen = Date.now();
    if (quality >= 3) {
      rec.successes++;
      rec.easeFactor = Math.max(1.3,
        rec.easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
      );
      if (rec.successes === 1)      rec.interval = 2;
      else if (rec.successes === 2) rec.interval = 4;
      else rec.interval = Math.round(rec.interval * rec.easeFactor);
    } else {
      rec.failures++;
      rec.interval = 1;
    }
    rec.nextDue = currentTurn + rec.interval;
    const key = `${rec.packId}::${rec.wordId}`;
    progress[key] = rec;
    saveProgress(progress);
  }

  /* ── Sessions ──────────────────────────────── */
  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(KEY_SESSIONS) || '[]');
    } catch { return []; }
  }

  function saveSession(session) {
    const sessions = loadSessions();
    sessions.unshift(session);
    if (sessions.length > 500) sessions.length = 500;
    localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
  }

  /* ── Turn counter ──────────────────────────── */
  function loadTurn()      { return parseInt(localStorage.getItem(KEY_TURN) || '0', 10); }
  function incrementTurn() {
    const t = loadTurn() + 1;
    localStorage.setItem(KEY_TURN, String(t));
    return t;
  }

  /* ── Custom packs ──────────────────────────── */
  function loadCustomPacks() {
    try {
      return JSON.parse(localStorage.getItem(KEY_CUSTOM) || '[]');
    } catch { return []; }
  }

  function saveCustomPack(pack) {
    const packs = loadCustomPacks();
    const idx = packs.findIndex(p => p.meta.id === pack.meta.id);
    if (idx >= 0) packs[idx] = pack; else packs.push(pack);
    localStorage.setItem(KEY_CUSTOM, JSON.stringify(packs));
  }

  function removeCustomPack(id) {
    const packs = loadCustomPacks().filter(p => p.meta.id !== id);
    localStorage.setItem(KEY_CUSTOM, JSON.stringify(packs));
  }

  /* ── Aggregate stats ───────────────────────── */
  function getStats() {
    const sessions = loadSessions();
    const progress = loadProgress();

    const today = new Date().toISOString().slice(0, 10);
    const allDates = [...new Set(sessions.map(s => s.date))];
    const streak = _calcStreak(allDates, today);
    const totalWords = Object.values(progress).filter(r => r.successes > 0).length;

    const weakWords = Object.values(progress)
      .filter(r => r.letterErrors > 0)
      .sort((a, b) => b.letterErrors - a.letterErrors)
      .slice(0, 10);

    return { streak, totalWords, sessions: sessions.length, allDates, weakWords };
  }

  function _calcStreak(sortedDates, today) {
    if (!sortedDates.includes(today)) return 0;
    const unique = [...new Set(sortedDates)].sort().reverse();
    let streak = 0;
    let cursor = new Date(today);
    for (const d of unique) {
      const expected = cursor.toISOString().slice(0, 10);
      if (d === expected) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  }

  /* ── Export ────────────────────────────────── */
  function exportAll() {
    const data = {
      exportedAt: new Date().toISOString(),
      settings:   loadSettings(),
      progress:   loadProgress(),
      sessions:   loadSessions(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `worddrop-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  function resetAll() {
    [KEY_SESSIONS, KEY_PROGRESS, KEY_CUSTOM, KEY_TURN, KEY_BOOK_PROG, KEY_LAST_MODE]
      .forEach(k => localStorage.removeItem(k));
  }

  /* ── Book reading progress ─────────────────── */
  function loadBookProgress() {
    try { return JSON.parse(localStorage.getItem(KEY_BOOK_PROG) || '{}'); }
    catch { return {}; }
  }
  function saveBookProgress(bp) {
    localStorage.setItem(KEY_BOOK_PROG, JSON.stringify(bp));
  }
  function recordBookPage(bookId, pageIndex, mode) {
    const bp = loadBookProgress();
    bp[bookId] = bp[bookId] || { readPages: {}, clozePages: {}, lastPage: 0, lastSeen: 0 };
    const bucket = mode === 'cloze' ? 'clozePages' : 'readPages';
    bp[bookId][bucket][pageIndex] = (bp[bookId][bucket][pageIndex] || 0) + 1;
    bp[bookId].lastPage = pageIndex;
    bp[bookId].lastSeen = Date.now();
    bp[bookId].lastMode = mode;
    saveBookProgress(bp);
  }

  /* Derive an auto-generated word pack from book progress.
     A word "graduates" from books once it has ≥2 successful attempts across distinct days. */
  function getBooksAutoPack(bookMetaById) {
    const progress = loadProgress();
    const words = [];
    const seen  = new Set();
    Object.values(progress).forEach(r => {
      if (!r.packId?.startsWith('book::'))       return;
      if (r.successes < 2)                       return;
      if (seen.has(r.wordId))                    return;
      seen.add(r.wordId);
      const bookId = r.packId.replace(/^book::/, '');
      const book   = bookMetaById?.[bookId];
      words.push({
        word:         r.wordId,
        image:        r.image || null,
        emoji:        r.emoji || (book?.cover || '📖'),
        sentence:     r.sentence || '',
        sourceBook:   book?.title || bookId,
        difficulty:   1,
        translations: {},
        tags:         ['from-books'],
      });
    });
    return {
      meta: { id: 'auto::from-books', name: 'From Books', icon: '📖', type: 'custom' },
      words,
    };
  }

  /* ── Last-played mode (home screen resume) ── */
  function loadLastMode() {
    try { return JSON.parse(localStorage.getItem(KEY_LAST_MODE) || 'null'); }
    catch { return null; }
  }
  function saveLastMode(mode, detail) {
    localStorage.setItem(KEY_LAST_MODE, JSON.stringify({ mode, detail, at: Date.now() }));
  }

  return {
    DEFAULT_SETTINGS,
    loadSettings, saveSettings,
    loadProgress, saveProgress, getRecord, updateRecord,
    loadSessions, saveSession,
    loadTurn, incrementTurn,
    loadCustomPacks, saveCustomPack, removeCustomPack,
    loadBookProgress, recordBookPage, getBooksAutoPack,
    loadLastMode, saveLastMode,
    getStats, exportAll, resetAll,
  };
})();
