/* ═══════════════════════════════════════════════════
   game.js — Main loop, state machine, orchestrator
═══════════════════════════════════════════════════ */
const Game = (() => {

  /* ── Speed config ──────────────────────────── */
  const SPEED_CONFIGS = {
    beginner: { spawnInterval: 25000, fallSpeed:  80, maxItems: 1 },
    normal:   { spawnInterval: 15000, fallSpeed: 120, maxItems: 2 },
    fast:     { spawnInterval: 10000, fallSpeed: 180, maxItems: 3 },
    expert:   { spawnInterval:  6000, fallSpeed: 240, maxItems: 4 },
  };

  /* ── State ─────────────────────────────────── */
  let settings     = {};
  let wordList     = [];
  let currentPack  = null;

  let fallingItems = [];   /* array of FallingItem */
  let activeItem   = null; /* item currently being typed */
  let typingState  = null;

  let score        = 0;
  let streak       = 0;       /* word-level streak (consecutive successful words) */
  let maxStreak    = 0;
  let letterCombo  = 0;       /* letter-level combo, persists across words */
  let maxCombo     = 0;
  let sessionResults = [];

  let lastTimestamp  = 0;
  let spawnTimer     = 0;
  let running        = false;
  let rafId          = null;

  let flashOverlay   = null;
  let flashTimer     = 0;

  /* Review-after-miss state (syllable playback + forced retype) */
  let isSpelling     = false;
  let spellCtx       = null;  /* see _reviewAfterMiss for shape */
  let spellSkip      = false;
  let _resolveTyping = null;  /* resolves the typing-phase Promise */
  let _skipArmed     = false;
  let _skipArmTimer  = null;
  const SKIP_ARM_MS  = 1200;

  /* Preload pipeline: keep the next word ready so spawn is instant */
  let nextPrefetched = null;   /* { word, img } or null */
  let _prefetching   = false;
  let _spawning      = false;

  /* ── Boot ──────────────────────────────────── */
  async function boot() {
    settings = Records.loadSettings();
    Audio.init(settings);
    WordLoader.setGiphyKey(settings.giphyKey || '');
    Renderer.init(document.getElementById('game-canvas'));

    const manifest    = await WordLoader.loadManifest();
    const customPacks = Records.loadCustomPacks();

    Renderer.init(
      document.getElementById('game-canvas'),
      key => _onKey(key),               /* virtual keyboard tap */
      () => pause(),                    /* pause button tap */
      () => _skipSpell()                /* tap anywhere during spelling */
    );
    UI.init(settings, _onPackSelected, _onSettingsChanged);
    await UI.buildPackList(manifest, customPacks);
    Input.init(_onKey);

    /* Book mode setup */
    await Book.init();
    window._booksManifest = Book.getManifest();
    UI.renderHomeRecent();

    UI.showScreen('home');
  }

  /* ── Pack selected ─────────────────────────── */
  async function _onPackSelected(packMeta) {
    let raw;
    if (packMeta._raw) {
      raw = packMeta._raw;
    } else {
      raw = await WordLoader.loadPack(packMeta.path);
    }
    wordList    = WordLoader.parsePack(raw, packMeta.id);
    currentPack = packMeta;

    Records.saveLastMode('drop', { packId: packMeta.id, packName: packMeta.name });

    const progress = Records.loadProgress();
    const turn     = Records.loadTurn();
    WordEngine.init(wordList, progress, turn);

    _startSession();
  }

  /* ── Session ───────────────────────────────── */
  function _startSession() {
    fallingItems   = [];
    activeItem     = null;
    typingState    = null;
    score          = 0;
    streak         = 0;
    maxStreak      = 0;
    letterCombo    = 0;
    maxCombo       = 0;
    sessionResults = [];
    spawnTimer     = 0;
    flashOverlay   = null;
    nextPrefetched = null;
    _prefetching   = false;
    _spawning      = false;

    UI.showScreen('game');
    Renderer.setKeyboardVisible(settings.showKeyboard);
    Renderer.stripReset();
    Renderer.clearParticles();
    Audio.startBGM();

    running = true;
    lastTimestamp = performance.now();
    _spawnWord();
    rafId = requestAnimationFrame(_loop);
  }

  function endSession() {
    running = false;
    cancelAnimationFrame(rafId);
    Audio.stopBGM();
    Renderer.setKeyboardVisible(false);
    _saveSession();
    _showSummary();
  }

  function restart() {
    if (currentPack) _onPackSelected(currentPack);
  }

  function pause() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    Audio.stopBGM();
    UI.showOverlay('pause');
  }

  function resume() {
    if (running) return;
    UI.hideOverlay('pause');
    if (settings.bgmEnabled) Audio.startBGM();
    running = true;
    lastTimestamp = performance.now();
    rafId = requestAnimationFrame(_loop);
  }

  /* ── Main loop ─────────────────────────────── */
  function _loop(ts) {
    if (!running) return;
    const dt = Math.min((ts - lastTimestamp) / 1000, 0.1);
    lastTimestamp = ts;

    /* All game-logic updates (spawn, fall, miss-detect, active-switch) pause during spelling */
    if (!isSpelling) {
      const cfg = _speedCfg();

      /* Spawn: fire immediately when screen has no live item (tight pacing),
         otherwise wait for spawnInterval before adding the next concurrent item */
      spawnTimer += dt * 1000;
      const liveCount = fallingItems.filter(i => !i.missed).length;
      const screenEmpty     = liveCount === 0;
      const intervalElapsed = spawnTimer >= cfg.spawnInterval;
      if ((screenEmpty || intervalElapsed) && liveCount < cfg.maxItems && !_spawning) {
        spawnTimer = 0;
        _spawnWord();
      }

      const danger = Renderer.getDangerY();
      fallingItems.forEach(item => {
        if (item.freezeTimer > 0) {
          item.freezeTimer -= dt * 1000;
        } else {
          item.y += item.speed * dt;
        }
        if (item.shakeTimer > 0) {
          item.shakeTimer -= dt * 1000;
          item.shakeOffset = Math.sin(ts / 40) * 8;
        } else {
          item.shakeOffset = 0;
        }
      });

      fallingItems.forEach(item => {
        if (!item.missed && item.y + (item.word.imageSize || 200) >= danger) {
          item.missed = true;
          _onWordMiss(item);
        }
      });

      fallingItems = fallingItems.filter(item => {
        if (item.missed && item.y > danger + 200) return false;
        return true;
      });

      const live = fallingItems.filter(i => !i.missed);
      const newActive = live.sort((a, b) => b.y - a.y)[0] || null;
      if (newActive !== activeItem) _switchActive(newActive);
    }

    if (flashOverlay) {
      flashTimer -= dt;
      flashOverlay.alpha = Math.max(0, flashTimer / 0.3);
      if (flashTimer <= 0) flashOverlay = null;
    }

    if (typingState && typingState.wrongFlashTimer > 0) {
      typingState.wrongFlashTimer -= dt * 1000;
    }

    if (spellCtx && spellCtx.wrongFlashT > 0) {
      spellCtx.wrongFlashT -= dt * 1000;
    }

    Renderer.draw({
      gameState: isSpelling ? 'spelling' : 'playing',
      spellCtx,
      fallingItems,
      activeItem,
      typingState,
      score, streak, letterCombo,
      speedLabel: settings.speed?.toUpperCase(),
      settings,
      flashOverlay,
    });

    rafId = requestAnimationFrame(_loop);
  }

  /* ── Spawn ─────────────────────────────────── */
  async function _spawnWord() {
    if (_spawning) return;
    _spawning = true;
    try {
      let word, img;
      if (nextPrefetched) {
        ({ word, img } = nextPrefetched);
        nextPrefetched = null;
      } else {
        /* Cold path: first spawn, or prefetch not yet ready — load inline */
        word = WordEngine.selectNext();
        if (!word) return;
        const [url] = await Promise.all([
          WordLoader.resolveImage(word),
          Audio.prefetchWord(word.word),
        ]);
        img = await WordLoader.preloadImage(url);
      }

      const cfg = _speedCfg();
      fallingItems.push({
        word,
        x: Renderer.getCanvasW() / 2,
        y: Renderer.getSpawnY(),
        speed:       cfg.fallSpeed,
        img,
        shakeOffset: 0,
        shakeTimer:  0,
        freezeTimer: 0,
        missed:      false,
        errorCount:  0,
      });

      if (!activeItem) _switchActive(fallingItems[fallingItems.length - 1]);
      Audio.speakWord(word.word);
    } finally {
      _spawning = false;
    }

    /* Fire-and-forget: start loading the word AFTER this one */
    _prefetchNext();
  }

  async function _prefetchNext() {
    if (nextPrefetched || _prefetching) return;
    _prefetching = true;
    try {
      const word = WordEngine.selectNext();
      if (!word) return;
      const [url] = await Promise.all([
        WordLoader.resolveImage(word),
        Audio.prefetchWord(word.word),
      ]);
      const img = await WordLoader.preloadImage(url);
      nextPrefetched = { word, img };
    } finally {
      _prefetching = false;
    }
  }

  /* ── Switch active word ────────────────────── */
  function _switchActive(item) {
    activeItem = item;
    Renderer.resetAllKeys();
    if (item) {
      typingState = {
        target:          item.word.word,
        typed:           '',
        cursorIndex:     0,
        errorCount:      0,
        wrongFlashTimer: 0,
      };
      Renderer.stripPushActive(item.word.word);
    } else {
      typingState = null;
    }
  }

  /* ── Key handler ───────────────────────────── */
  function _onKey(key) {
    if (isSpelling) {
      if (spellCtx?.phase === 'typing') _reviewKey(key);
      /* In intro/syllables/done phases, keys are ignored — tap outside keyboard to skip */
      return;
    }
    if (key === 'ESCAPE') {
      pause();
      return;
    }
    if (!activeItem || !typingState || activeItem.missed) return;

    const expected = typingState.target[typingState.cursorIndex];
    if (key.toLowerCase() === expected.toLowerCase()) {
      _onCorrectKey(expected);
    } else {
      _onWrongKey();
    }
  }

  /* ── Review typing-phase key handler ────────── */
  function _reviewKey(key) {
    if (!spellCtx) return;
    const { word, typedIndex, syllables } = spellCtx;
    const expected = word[typedIndex];
    if (!expected) return;
    if (key.toLowerCase() === expected.toLowerCase()) {
      spellCtx.typedIndex++;
      Renderer.highlightKey(expected.toLowerCase(), 'correct');
      if (spellCtx.typedIndex >= word.length) {
        _resolveTyping?.();
      }
    } else {
      spellCtx.wrongFlashT = 400;
      Renderer.highlightKey(expected.toLowerCase(), 'wrong');
      /* Re-say syllable containing current letter to reinforce */
      const sylIdx = _letterToSyllableIndex(spellCtx.typedIndex, syllables);
      Audio.stopSpeech();
      Audio.speak(syllables[sylIdx]);
    }
  }

  function _letterToSyllableIndex(letterIdx, syllables) {
    let acc = 0;
    for (let i = 0; i < syllables.length; i++) {
      acc += syllables[i].length;
      if (letterIdx < acc) return i;
    }
    return syllables.length - 1;
  }

  function _onCorrectKey(letter) {
    typingState.typed += letter;
    typingState.cursorIndex++;
    Renderer.highlightKey(letter.toLowerCase(), 'correct');
    Renderer.stripUpdateTyped(typingState.typed);
    activeItem.freezeTimer = 1250;

    /* Per-letter scoring with tier multiplier */
    const oldTier = _comboTier(letterCombo);
    score += 10 * oldTier;
    letterCombo++;
    if (letterCombo > maxCombo) maxCombo = letterCombo;
    const newTier = _comboTier(letterCombo);
    if (newTier > oldTier) {
      score += (TIER_MILESTONE_BONUS[newTier] || 0);
      Renderer.triggerTierBanner(TIER_BANNERS[newTier], TIER_COLORS[newTier]);
      Renderer.triggerShake(4 + newTier, 200);
    }
    if (letterCombo === 100) {
      score += COMBO_100_BONUS;
      Renderer.triggerTierBanner('GODLIKE!', '#ffffff');
      Renderer.triggerShake(14, 400);
    }

    /* Juice: small particle burst on image + pentatonic blip tied to letter position */
    const size = activeItem.word.imageSize || 200;
    Renderer.emitBurst(activeItem.x, activeItem.y + size / 2, 'letterHit');
    Audio.playKeyBlip(typingState.cursorIndex - 1);

    if (typingState.cursorIndex >= typingState.target.length) {
      _onWordSuccess();
    }
  }

  function _onWrongKey() {
    typingState.errorCount++;
    activeItem.errorCount++;
    typingState.wrongFlashTimer = 500;
    activeItem.shakeTimer = 400;
    Renderer.stripWrongFlash();
    Renderer.highlightKey(
      typingState.target[typingState.cursorIndex].toLowerCase(),
      'wrong'
    );
    _setFlash('rgba(244,67,54,0.3)', 0.3);
    Audio.speakWord(activeItem.word.word);

    /* Tier demotion: drop combo to bottom of previous tier (one tier down) */
    if      (letterCombo >= 60) letterCombo = 30;
    else if (letterCombo >= 30) letterCombo = 15;
    else if (letterCombo >= 15) letterCombo = 5;
    else                        letterCombo = 0;
  }

  /* ── Word outcomes ─────────────────────────── */
  function _onWordSuccess() {
    const item = activeItem;
    streak++;
    if (streak > maxStreak) maxStreak = streak;

    /* Word-completion bonus: per-letter scoring already paid the bulk; this rewards
       finishing fast, never erring, and stringing words together (word-level streak). */
    const dangerY  = Renderer.getDangerY();
    const remaining = Math.max(0, 1 - item.y / dangerY);
    const diff     = item.word.difficulty || 1;
    const diffMult = [1.0, 1.0, 1.5, 2.5][diff] || 1.0;
    const pts = Math.round((
      remaining * 100 +
      (STREAK_BONUS[Math.min(streak, 7)] || 0) +
      (item.errorCount === 0 ? 50 : 0) -
      item.errorCount * 5
    ) * diffMult);
    score += Math.max(0, pts);

    sessionResults.push({ word: item.word.word, success: true, errors: item.errorCount });
    WordEngine.recordResult(item.word, item.errorCount, true);
    Renderer.stripResolveActive('success');

    /* Juice: celebrate — confetti burst, plus combo-scaled shake */
    const size = item.word.imageSize || 200;
    Renderer.emitBurst(item.x, item.y + size / 2, 'wordSuccess');
    if (streak >= 3)  Renderer.emitBurst(item.x, item.y + size / 2, 'comboPulse');
    if (streak >= 5)  Renderer.triggerShake(6,  180);
    if (streak >= 10) Renderer.triggerShake(10, 260);

    /* Remove from falling list */
    fallingItems = fallingItems.filter(i => i !== item);
    _setFlash('rgba(76,175,80,0.25)', 0.3);
    Audio.playSuccess();

    /* Pick next active; next spawn fires immediately via screenEmpty check in loop */
    const live = fallingItems.filter(i => !i.missed);
    _switchActive(live.sort((a, b) => b.y - a.y)[0] || null);
    spawnTimer = 0;
  }

  async function _onWordMiss(item) {
    streak = 0;
    /* Letter combo drops two tiers (≈ two wrong keys) — meaningful but not catastrophic */
    const t = _comboTier(letterCombo);
    const target = Math.max(1, t - 2);
    letterCombo = TIER_THRESHOLDS[target - 1];

    sessionResults.push({ word: item.word.word, success: false, errors: item.errorCount });
    WordEngine.recordResult(item.word, item.errorCount, false);
    WordEngine.requeueMissed(item.word);
    Renderer.stripResolveActive('miss');

    /* Juice: shatter the image + big screen shake */
    Renderer.emitShatter(item);
    Renderer.triggerShake(12, 320);

    Audio.playFail();

    if (settings.spellOnMiss !== false) {
      await _reviewAfterMiss(item);
    }

    if (activeItem === item) {
      const live = fallingItems.filter(i => !i.missed && i !== item);
      _switchActive(live.sort((a, b) => b.y - a.y)[0] || null);
    }
  }

  /* ── Review after miss: syllable playback + forced retype ──
     Phases:
       intro      — image + word shown, full word spoken
       syllables  — each syllable highlighted and spoken in sequence
       typing     — player must type the word correctly; wrong key re-says the syllable
       done       — brief celebration, full word spoken once more
     Two-tap outside the keyboard skips the entire card (escape hatch). */
  async function _reviewAfterMiss(item) {
    const word      = item.word.word;
    const syllables = (item.word.syllables && item.word.syllables.length)
      ? item.word.syllables
      : [word];

    isSpelling = true;
    spellSkip  = false;
    spellCtx   = {
      word,
      img:          item.img,
      emoji:        item.word.emoji,
      syllables,
      phase:        'intro',
      syllableIndex: -1,
      typedIndex:    0,
      wrongFlashT:   0,
    };

    /* Intro */
    await _sleep(300);
    if (spellSkip) return _endSpell();
    await Audio.speak(word);
    if (spellSkip) return _endSpell();
    await _sleep(250);
    if (spellSkip) return _endSpell();

    /* Syllable playback */
    spellCtx.phase = 'syllables';
    for (let i = 0; i < syllables.length; i++) {
      spellCtx.syllableIndex = i;
      await Audio.speak(syllables[i]);
      if (spellSkip) return _endSpell();
      await _sleep(200);
      if (spellSkip) return _endSpell();
    }
    spellCtx.syllableIndex = -1;
    await _sleep(300);
    if (spellSkip) return _endSpell();

    /* Forced retype — wait until player has typed the whole word (or skipped) */
    spellCtx.phase      = 'typing';
    spellCtx.typedIndex = 0;
    Renderer.resetAllKeys();
    await new Promise(resolve => { _resolveTyping = resolve; });
    _resolveTyping = null;
    if (spellSkip) return _endSpell();

    /* Done */
    spellCtx.phase = 'done';
    await _sleep(120);
    await Audio.speak(word);
    if (spellSkip) return _endSpell();
    await _sleep(400);

    _endSpell();
  }

  function _endSpell() {
    isSpelling    = false;
    spellCtx      = null;
    _resolveTyping = null;
    _skipArmed    = false;
    clearTimeout(_skipArmTimer);
    lastTimestamp = performance.now();  /* avoid dt spike next frame */
  }

  /* Two-tap skip: first tap arms, second tap (within SKIP_ARM_MS) actually skips.
     Prevents accidental dismissal of the learning card. */
  function _skipSpell() {
    if (!isSpelling) return;
    if (!_skipArmed) {
      _skipArmed = true;
      if (spellCtx) spellCtx.skipArmed = true;
      clearTimeout(_skipArmTimer);
      _skipArmTimer = setTimeout(() => {
        _skipArmed = false;
        if (spellCtx) spellCtx.skipArmed = false;
      }, SKIP_ARM_MS);
      return;
    }
    _skipArmed = false;
    clearTimeout(_skipArmTimer);
    spellSkip = true;
    Audio.stopSpeech();
    _resolveTyping?.();
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ── Flash helper ──────────────────────────── */
  function _setFlash(color, duration) {
    flashOverlay = { color, alpha: 1 };
    flashTimer = duration;
  }

  /* ── Speed config ──────────────────────────── */
  function _speedCfg() {
    return SPEED_CONFIGS[settings.speed] || SPEED_CONFIGS.normal;
  }

  /* ── Session save & summary ────────────────── */
  function _saveSession() {
    if (sessionResults.length === 0) return;
    const successes = sessionResults.filter(r => r.success).length;
    Records.saveSession({
      id:           Date.now(),
      date:         new Date().toISOString().slice(0, 10),
      packId:       currentPack?.id || 'unknown',
      packName:     currentPack?.name || '',
      duration:     Math.round((performance.now() - lastTimestamp) / 1000),
      wordsStudied: sessionResults.length,
      newWords:     [],
      reviewedWords: [],
      results:      Object.fromEntries(sessionResults.map(r => [r.word, { success: r.success, errors: r.errors }])),
      score,
      accuracy:     Math.round(successes / sessionResults.length * 100),
    });
  }

  function _showSummary() {
    const successes = sessionResults.filter(r => r.success).length;
    UI.showSummary({
      score,
      wordsStudied: sessionResults.length,
      accuracy:     sessionResults.length
        ? Math.round(successes / sessionResults.length * 100) : 0,
      maxStreak,
      wordResults:  sessionResults,
    });
  }

  /* ── Settings changed ──────────────────────── */
  function _onSettingsChanged(s) {
    settings = s;
    WordLoader.setGiphyKey(s.giphyKey || '');
    Audio.updateVolume(s.volume ?? 0.8);
    Renderer.setKeyboardVisible(s.showKeyboard);
    if (s.bgmEnabled) Audio.startBGM(); else Audio.stopBGM();
  }

  /* ── Scoring system ────────────────────────── */
  const STREAK_BONUS         = [0, 0, 10, 20, 30, 50, 75, 100];
  const TIER_THRESHOLDS      = [0, 5, 15, 30, 60];   /* index = tier-1, value = combo at start of tier */
  const TIER_MILESTONE_BONUS = { 2: 25, 3: 75, 4: 200, 5: 500 };
  const TIER_BANNERS         = { 2: 'Nice!', 3: 'Great!', 4: 'On Fire!', 5: 'Incredible!' };
  const COMBO_100_BONUS      = 1000;
  const TIER_COLORS          = { 1: '#b8c2ff', 2: '#7ed6ff', 3: '#ffd447', 4: '#ff8866', 5: '#d97aff' };

  function _comboTier(combo) {
    if (combo >= 60) return 5;
    if (combo >= 30) return 4;
    if (combo >= 15) return 3;
    if (combo >= 5)  return 2;
    return 1;
  }

  return { boot, endSession, restart, pause, resume };
})();

/* ── Boot on load ──────────────────────────────── */
window.Game = Game;
window.addEventListener('DOMContentLoaded', () => Game.boot());
