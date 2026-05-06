const Renderer = (() => {
  const W = 750, H = 1334;
  const HUD_H    = 120;
  const DANGER_Y = 980;
  const KB_Y     = 1174;
  const KB_H     = 160;

  /* Input strip — single canvas-wide box sitting 12px above the keyboard */
  const STRIP_H        = 96;
  const STRIP_Y        = KB_Y - 12 - STRIP_H;
  const STRIP_MARGIN_X = 12;
  const SLOT_SPACING   = 260;  /* horizontal distance between word centers */

  /* Keyboard layout */
  const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const KEY_W = 62, KEY_H = 44, KEY_GAP = 7;

  /* Pause button hit area (canvas coords) */
  const PAUSE_CX = W - 55, PAUSE_CY = HUD_H / 2, PAUSE_R = 28;

  let canvas, ctx;
  let _onVirtualKey = null;
  let _onPause      = null;
  let _onSkip       = null;
  let _showKeyboard = true;
  let _keyStates    = {}; /* letter → 'correct' | 'wrong' | null */

  /* Input-strip state */
  let _stripEntries  = [];  /* [{ word, typed, state, x, targetX, wrongFlashT }] */
  let _stripLastTs   = 0;

  /* Particle & shake state (juice) */
  let _particles       = [];  /* see emitBurst / emitShatter for shape */
  let _particlesLastTs = 0;
  let _shakeTime       = 0;
  let _shakeDuration   = 0;
  let _shakeIntensity  = 0;

  /* Tier bar + tier banner */
  let _tierBarFill     = 0;     /* smoothed combo value for bar animation */
  let _tierBarLastTs   = 0;
  let _tierBannerText  = null;
  let _tierBannerTime  = 0;
  let _tierBannerColor = '#fff';
  const TIER_BAR_Y      = 1042;
  const TIER_BAR_H      = 14;
  const TIER_BAR_PAD_X  = 16;
  const TIER_THRESHOLDS = [0, 5, 15, 30, 60, 100]; /* 6 entries: tier i ranges [i-1] .. [i] */
  const TIER_STYLES = {
    1: { fill: '#b8c2ff', dim: 'rgba(184,194,255,0.22)' },
    2: { fill: '#7ed6ff', dim: 'rgba(126,214,255,0.22)' },
    3: { fill: '#ffd447', dim: 'rgba(255,212,71,0.22)' },
    4: { fill: '#ff8866', dim: 'rgba(255,136,102,0.22)' },
    5: { fill: '#d97aff', dim: 'rgba(217,122,255,0.25)' },
  };

  function _tierFromCombo(c) {
    if (c >= 60) return 5;
    if (c >= 30) return 4;
    if (c >= 15) return 3;
    if (c >= 5)  return 2;
    return 1;
  }

  /* ── Init ──────────────────────────────────── */
  function init(c, virtualKeyCallback, pauseCallback, skipCallback) {
    canvas        = c;
    ctx           = c.getContext('2d');
    _onVirtualKey = virtualKeyCallback;
    _onPause      = pauseCallback;
    _onSkip       = skipCallback;
    canvas.addEventListener('pointerdown', _onCanvasPointer, { passive: false });
  }

  /* ── Canvas pointer → key / pause / skip ────── */
  let _spelling      = false;
  let _spellingPhase = null;

  function _onCanvasPointer(e) {
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    /* Pause button (works in both states) */
    const dx = cx - PAUSE_CX, dy = cy - PAUSE_CY;
    if (dx * dx + dy * dy <= PAUSE_R * PAUSE_R) {
      _onPause?.();
      return;
    }

    /* During review typing, allow keyboard taps; taps elsewhere = skip-arm */
    if (_spelling) {
      if (_spellingPhase === 'typing' && _showKeyboard && cy >= KB_Y) {
        const key = _hitTestKey(cx, cy);
        if (key) { _onVirtualKey?.(key); return; }
      }
      _onSkip?.();
      return;
    }

    /* Virtual keyboard */
    if (!_showKeyboard || cy < KB_Y) return;
    const key = _hitTestKey(cx, cy);
    if (key) _onVirtualKey?.(key);
  }

  function _hitTestKey(cx, cy) {
    for (let r = 0; r < KB_ROWS.length; r++) {
      const row  = KB_ROWS[r];
      const rowY = KB_Y + 12 + r * (KEY_H + KEY_GAP);
      if (cy < rowY || cy > rowY + KEY_H) continue;
      const totalW = row.length * KEY_W + (row.length - 1) * KEY_GAP;
      const startX = (W - totalW) / 2;
      for (let c = 0; c < row.length; c++) {
        const kx = startX + c * (KEY_W + KEY_GAP);
        if (cx >= kx && cx <= kx + KEY_W) return row[c];
      }
    }
    return null;
  }

  /* ── Key highlight API ─────────────────────── */
  function highlightKey(letter, state) {
    _keyStates[letter] = state;
    if (state === 'wrong') {
      setTimeout(() => { _keyStates[letter] = null; }, 320);
    }
  }

  function resetKey(letter)  { _keyStates[letter] = null; }
  function resetAllKeys()    { _keyStates = {}; }
  function setKeyboardVisible(v) { _showKeyboard = v; }

  /* ── Main draw ─────────────────────────────── */
  function draw(state) {
    const {
      gameState, spellCtx,
      fallingItems, activeItem, typingState,
      score, streak, letterCombo = 0, speedLabel,
      settings, flashOverlay,
    } = state;

    const spelling = gameState === 'spelling';
    _spelling      = spelling;
    _spellingPhase = spellCtx?.phase || null;

    ctx.clearRect(0, 0, W, H);
    _drawBackground();
    _drawHUD(score, streak, letterCombo, speedLabel);
    _drawDangerLine();

    /* Shake: applied only to the play-field layer, NOT HUD / strip / keyboard */
    const shake = _computeShakeOffset();
    ctx.save();
    if (shake) ctx.translate(shake.x, shake.y);

    fallingItems.forEach(item => {
      /* Missed items are replaced by shatter particles — don't double-draw */
      if (item.missed) return;
      _drawFallingItem(item, activeItem && item.word.id === activeItem.word.id, settings, letterCombo);
    });

    _updateAndDrawParticles();
    ctx.restore();

    _drawTierBar(letterCombo);
    _drawInputStrip();
    if (flashOverlay)           _drawFlash(flashOverlay.color, flashOverlay.alpha);
    if (spelling && spellCtx)   _drawSpellingCard(spellCtx);

    /* Keyboard drawn last so it sits on top of the review card during typing */
    const kbVisible = _showKeyboard && (!spelling || spellCtx?.phase === 'typing');
    if (kbVisible) _drawKeyboard(typingState?.target);

    /* Tier banner always on top (celebrates milestones even over keyboard) */
    _drawTierBanner();
  }

  /* ── Background ────────────────────────────── */
  function _drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,   '#1a1a2e');
    grad.addColorStop(0.5, '#16213e');
    grad.addColorStop(1,   '#0f3460');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── HUD ───────────────────────────────────── */
  function _drawHUD(score, streak, letterCombo, speedLabel) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, HUD_H);

    /* Score (left) */
    ctx.font = 'bold 36px system-ui';
    ctx.fillStyle = '#e8e8f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${score}`, 24, HUD_H / 2);

    /* Letter combo + multiplier (center, hero) */
    const tier  = _tierFromCombo(letterCombo);
    const style = TIER_STYLES[tier];
    if (letterCombo > 0) {
      ctx.shadowColor = style.fill;
      ctx.shadowBlur  = 18;
      ctx.fillStyle   = style.fill;
      ctx.font        = 'bold 52px system-ui';
      ctx.textAlign   = 'right';
      ctx.fillText(`⚡${letterCombo}`, W / 2 + 10, HUD_H / 2);
      ctx.font        = 'bold 32px system-ui';
      ctx.textAlign   = 'left';
      ctx.fillText(`×${tier}`, W / 2 + 22, HUD_H / 2 + 2);
      ctx.shadowBlur  = 0;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font      = 'bold 36px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`⚡ 0`, W / 2, HUD_H / 2);
    }

    /* Word streak (small, right of center) */
    if (streak > 1) {
      ctx.font      = 'bold 24px system-ui';
      ctx.fillStyle = '#f5a623';
      ctx.textAlign = 'left';
      ctx.fillText(`🔥${streak}`, W - 200, HUD_H / 2 - 14);
    }

    /* Speed label (small, below word streak) */
    ctx.font      = '16px system-ui';
    ctx.fillStyle = '#8888aa';
    ctx.textAlign = 'left';
    ctx.fillText(speedLabel || '', W - 200, HUD_H / 2 + 22);

    /* Pause button */
    ctx.beginPath();
    ctx.arc(PAUSE_CX, PAUSE_CY, PAUSE_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* Pause icon (two bars) */
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(PAUSE_CX - 10, PAUSE_CY - 11, 7, 22);
    ctx.fillRect(PAUSE_CX + 3,  PAUSE_CY - 11, 7, 22);

    ctx.textBaseline = 'alphabetic';
  }

  /* ── Danger line ───────────────────────────── */
  function _drawDangerLine() {
    const grad = ctx.createLinearGradient(0, DANGER_Y - 20, 0, DANGER_Y + 10);
    grad.addColorStop(0, 'rgba(244,67,54,0)');
    grad.addColorStop(1, 'rgba(244,67,54,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, DANGER_Y - 20, W, 30);

    ctx.strokeStyle = 'rgba(244,67,54,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y);
    ctx.lineTo(W, DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── Falling item ──────────────────────────── */
  function _drawFallingItem(item, isActive, settings, streak = 0) {
    const { word, x, y, img, shakeOffset, freezeTimer } = item;
    const size   = word.imageSize || 200;
    const cx     = x + shakeOffset;
    const frozen = freezeTimer > 0;

    /* Combo-tier glow on the active falling image */
    const tier = isActive ? _comboTier(streak) : 0;

    ctx.globalAlpha = isActive ? 1 : 0.4;
    if (frozen) {
      ctx.shadowColor = '#7ed6ff'; ctx.shadowBlur = 30;
    } else if (isActive) {
      if (tier === 0)      { ctx.shadowColor = '#e94560'; ctx.shadowBlur = 24; }
      else if (tier === 1) { ctx.shadowColor = '#f5a623'; ctx.shadowBlur = 38; }
      else if (tier === 2) { ctx.shadowColor = '#ffd447'; ctx.shadowBlur = 52; }
      else                 { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 72; }
    }

    if (img) {
      ctx.drawImage(img, cx - size / 2, y, size, size);
    } else {
      ctx.font = `${size * 0.85}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff';
      ctx.fillText(word.emoji, cx, y);
    }

    ctx.shadowBlur = 0;

    /* Ice overlay during freeze */
    if (frozen) {
      const alpha = Math.min(0.45, freezeTimer / 500 * 0.45);
      ctx.fillStyle = `rgba(180,230,255,${alpha})`;
      ctx.fillRect(cx - size / 2, y, size, size);
      ctx.strokeStyle = `rgba(220,245,255,${alpha + 0.2})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - size / 2, y, size, size);
    }

    const lang  = settings?.translationLang;
    const trans = lang && lang !== 'off' ? word.translations?.[lang] : null;
    if (trans) {
      ctx.font = '28px system-ui';
      ctx.fillStyle = isActive ? '#f5a623' : '#8888aa';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(trans, cx, y + size + 8);
    }

    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  /* ── Input strip (canvas-wide free-text box) ── */
  function stripPushActive(word) {
    /* Any lingering 'active' (shouldn't happen; defensive) → mark miss */
    _stripEntries.forEach(e => { if (e.state === 'active') e.state = 'miss'; });
    /* Existing entries shift one slot to the left */
    _stripEntries.forEach(e => { e.targetX -= SLOT_SPACING; });
    _stripEntries.push({
      word,
      typed:       '',
      state:       'active',
      x:           W + SLOT_SPACING / 2,
      targetX:     W / 2,
      wrongFlashT: 0,
    });
  }

  function stripUpdateTyped(typed) {
    const a = _stripEntries.find(e => e.state === 'active');
    if (a) a.typed = typed;
  }

  function stripWrongFlash() {
    const a = _stripEntries.find(e => e.state === 'active');
    if (a) a.wrongFlashT = 400;
  }

  function stripResolveActive(kind /* 'success' | 'miss' */) {
    const a = _stripEntries.find(e => e.state === 'active');
    if (!a) return;
    a.state = kind;
    a.typed = a.word;
  }

  function stripReset() {
    _stripEntries = [];
    _stripLastTs  = 0;
  }

  function _drawInputStrip() {
    const now = performance.now();
    const dt  = _stripLastTs ? Math.min(0.1, (now - _stripLastTs) / 1000) : 0;
    _stripLastTs = now;

    /* Ease positions toward target and age flash timers */
    _stripEntries.forEach(e => {
      e.x += (e.targetX - e.x) * (1 - Math.exp(-dt * 7));
      if (e.wrongFlashT > 0) e.wrongFlashT -= dt * 1000;
    });
    /* Cull entries that have slid fully off the left edge */
    _stripEntries = _stripEntries.filter(e => e.x > -SLOT_SPACING / 2);

    /* Strip background */
    const stripX = STRIP_MARGIN_X;
    const stripW = W - STRIP_MARGIN_X * 2;
    ctx.fillStyle = 'rgba(8,10,22,0.85)';
    _roundRect(stripX, STRIP_Y, stripW, STRIP_H, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(126,214,255,0.22)';
    ctx.lineWidth = 1.5;
    _roundRect(stripX, STRIP_Y, stripW, STRIP_H, 16); ctx.stroke();

    /* Clip contents inside rounded strip */
    ctx.save();
    _roundRect(stripX, STRIP_Y, stripW, STRIP_H, 16);
    ctx.clip();

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const centerY = STRIP_Y + STRIP_H / 2;
    const caretBlinkOn = Math.floor(now / 500) % 2 === 0;

    _stripEntries.forEach(e => {
      const isActive = e.state === 'active';
      const display  = isActive ? e.typed : e.word;

      /* Auto-scale font to fit within slot */
      const maxW = SLOT_SPACING - 40;
      let size   = isActive ? 52 : 40;
      ctx.font   = `bold ${size}px system-ui`;
      let textW  = ctx.measureText(display || ' ').width;
      if (textW > maxW) {
        size  = Math.max(22, Math.floor(size * maxW / textW));
        ctx.font = `bold ${size}px system-ui`;
        textW = ctx.measureText(display || ' ').width;
      }

      /* Color by state (with wrong-flash override for active) */
      let color;
      if (isActive) {
        color = e.wrongFlashT > 0 ? '#ff6b6b' : '#ffffff';
      } else if (e.state === 'success') {
        color = '#6ed86a';
      } else {
        color = '#f47272';
      }

      /* Fade older done entries as they drift left of center */
      if (!isActive) {
        const distRatio = Math.min(1, (W / 2 - e.x) / (W / 2));
        ctx.globalAlpha = Math.max(0.35, 1 - distRatio * 0.55);
      } else {
        ctx.globalAlpha = 1;
      }

      if (display) {
        ctx.fillStyle = color;
        ctx.fillText(display, e.x, centerY);
      }

      /* Caret after last typed letter (active only) */
      if (isActive && caretBlinkOn) {
        const caretX = e.x + textW / 2 + (display ? 6 : 0);
        const h      = size * 0.9;
        ctx.fillStyle = '#7ed6ff';
        ctx.fillRect(caretX, centerY - h / 2, 3, h);
      }

      ctx.globalAlpha = 1;
    });

    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  /* ── Virtual keyboard (drawn on canvas) ────── */
  function _drawKeyboard(typingTarget) {
    /* Background strip */
    ctx.fillStyle = 'rgba(8,10,22,0.92)';
    ctx.fillRect(0, KB_Y, W, KB_H);

    /* Separator line */
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, KB_Y); ctx.lineTo(W, KB_Y);
    ctx.stroke();

    KB_ROWS.forEach((row, r) => {
      const totalW = row.length * KEY_W + (row.length - 1) * KEY_GAP;
      const startX = (W - totalW) / 2;
      const keyY   = KB_Y + 12 + r * (KEY_H + KEY_GAP);

      [...row].forEach((letter, c) => {
        const kx    = startX + c * (KEY_W + KEY_GAP);
        const state = _keyStates[letter];

        /* Key background */
        let bg     = 'rgba(255,255,255,0.08)';
        let fgColor = '#e8e8f0';
        if (state === 'correct') { bg = '#4caf50'; fgColor = '#fff'; }
        if (state === 'wrong')   { bg = '#f44336'; fgColor = '#fff'; }

        ctx.fillStyle = bg;
        _roundRect(kx, keyY, KEY_W, KEY_H, 7); ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = 1;
        _roundRect(kx, keyY, KEY_W, KEY_H, 7); ctx.stroke();

        /* Letter (lowercase — no shift needed, case-insensitive input) */
        ctx.font = `600 18px system-ui`;
        ctx.fillStyle = fgColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, kx + KEY_W / 2, keyY + KEY_H / 2);
      });
    });

    ctx.textBaseline = 'alphabetic';
  }

  /* ── Review card (after miss) ──────────────── */
  function _drawSpellingCard(sc) {
    const { word, img, emoji, syllables, phase, syllableIndex, typedIndex, wrongFlashT } = sc;

    /* Full-screen dim */
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, W, H);

    /* Card */
    const cardW = 660, cardH = 900;
    const cardX = (W - cardW) / 2;
    const cardY = 120;
    ctx.fillStyle = 'rgba(26,74,122,0.96)';
    _roundRect(cardX, cardY, cardW, cardH, 24); ctx.fill();
    ctx.strokeStyle = 'rgba(126,214,255,0.45)';
    ctx.lineWidth = 2;
    _roundRect(cardX, cardY, cardW, cardH, 24); ctx.stroke();

    /* Image / emoji */
    const imgSize = 320;
    const imgX    = cardX + (cardW - imgSize) / 2;
    const imgY    = cardY + 40;
    if (img) {
      ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
    } else if (emoji) {
      ctx.font = `${imgSize * 0.85}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(emoji, imgX + imgSize / 2, imgY + imgSize / 2);
    }

    /* Syllable label row (e.g. "straw · ber · ry") */
    const syllableY = cardY + 420;
    _drawSyllableLabels(syllables, syllableIndex, phase, syllableY, cardW);

    /* Letter slots — grouped by syllable, auto-scale to fit card width */
    _drawLetterSlots(
      word, syllables,
      phase, typedIndex, syllableIndex, wrongFlashT,
      cardY + 520, cardW,
    );

    /* Helper text */
    ctx.font = '20px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let helper;
    if (phase === 'intro')          helper = 'Listen…';
    else if (phase === 'syllables') helper = 'Listen to each syllable';
    else if (phase === 'typing')    helper = 'Now type the word';
    else                            helper = 'Great!';
    ctx.fillText(helper, W / 2, cardY + cardH - 90);

    /* Skip hint (two-tap) */
    ctx.font = sc.skipArmed ? 'bold 20px system-ui' : '18px system-ui';
    ctx.fillStyle = sc.skipArmed ? '#f5a623' : 'rgba(255,255,255,0.35)';
    ctx.fillText(
      sc.skipArmed ? 'Tap again to skip' : 'Tap outside keyboard twice to skip',
      W / 2, cardY + cardH - 50
    );

    ctx.textBaseline = 'alphabetic';
  }

  function _drawSyllableLabels(syllables, syllableIndex, phase, y, cardW) {
    const maxW = cardW - 60;
    let size = 34, gap = 28;

    const measure = () => {
      let total = 0;
      syllables.forEach(s => {
        ctx.font = `bold ${size}px system-ui`;
        total += ctx.measureText(s).width;
      });
      return total + (syllables.length - 1) * gap;
    };
    let totalW = measure();
    if (totalW > maxW) {
      const scale = maxW / totalW;
      size = Math.max(18, Math.floor(size * scale));
      gap  = Math.max(10, Math.floor(gap * scale));
      totalW = measure();
    }

    ctx.font = `bold ${size}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let x = (W - totalW) / 2;
    syllables.forEach((s, i) => {
      const w = ctx.measureText(s).width;
      const active = phase === 'syllables' && i === syllableIndex;
      if (active) {
        ctx.fillStyle   = '#7ed6ff';
        ctx.shadowColor = '#7ed6ff';
        ctx.shadowBlur  = 22;
      } else {
        ctx.fillStyle = 'rgba(232,232,240,0.55)';
      }
      ctx.fillText(s, x + w / 2, y);
      ctx.shadowBlur = 0;

      /* Separator dot between syllables */
      if (i < syllables.length - 1) {
        const dotX = x + w + gap / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(dotX, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      x += w + gap;
    });
  }

  function _drawLetterSlots(word, syllables, phase, typedIndex, syllableIndex, wrongFlashT, y, cardW) {
    const maxW = cardW - 40;
    let slotW = 48, slotH = 60, letterGap = 4, groupGap = 22;

    const totalW = () =>
      word.length * slotW + (word.length - 1) * letterGap +
      (syllables.length - 1) * (groupGap - letterGap);

    if (totalW() > maxW) {
      const scale = maxW / totalW();
      slotW     = Math.max(26, Math.floor(slotW * scale));
      slotH     = Math.max(34, Math.floor(slotH * scale));
      letterGap = Math.max(2,  Math.floor(letterGap * scale));
      groupGap  = Math.max(10, Math.floor(groupGap * scale));
    }

    /* Build: for each letter, which syllable it belongs to */
    const letterToSyl = [];
    let acc = 0;
    syllables.forEach((s, si) => {
      for (let k = 0; k < s.length; k++) letterToSyl.push(si);
      acc += s.length;
    });
    /* If heuristic syllables don't sum to word length, fall back to single group */
    if (letterToSyl.length !== word.length) {
      letterToSyl.length = 0;
      for (let i = 0; i < word.length; i++) letterToSyl.push(0);
    }

    const startX = (W - totalW()) / 2;
    let x = startX;
    const isTyping   = phase === 'typing';
    const showLetters = phase !== 'typing';  /* intro/syllables/done reveal letters */

    for (let i = 0; i < word.length; i++) {
      const letter = word[i];
      const sylI   = letterToSyl[i];
      const inActiveSyl = phase === 'syllables' && sylI === syllableIndex;

      /* Slot colors */
      let bg, border, textColor;
      if (phase === 'done') {
        bg = '#4caf50'; border = '#4caf50'; textColor = '#fff';
      } else if (isTyping && i < typedIndex) {
        bg = '#4caf50'; border = '#4caf50'; textColor = '#fff';
      } else if (isTyping && i === typedIndex) {
        const flashing = wrongFlashT > 0;
        border = flashing ? '#f44336' : '#7ed6ff';
        bg     = flashing ? 'rgba(244,67,54,0.25)' : 'rgba(126,214,255,0.18)';
        textColor = 'transparent';
      } else if (inActiveSyl) {
        bg = 'rgba(126,214,255,0.22)'; border = '#7ed6ff'; textColor = '#e8e8f0';
      } else {
        bg = 'rgba(255,255,255,0.06)'; border = 'rgba(255,255,255,0.18)';
        textColor = showLetters ? 'rgba(232,232,240,0.7)' : 'transparent';
      }

      ctx.fillStyle = bg;
      _roundRect(x, y, slotW, slotH, 8); ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      _roundRect(x, y, slotW, slotH, 8); ctx.stroke();

      if (textColor !== 'transparent') {
        ctx.font = `bold ${Math.floor(slotH * 0.5)}px system-ui`;
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, x + slotW / 2, y + slotH / 2);
      }

      /* Advance x — larger gap at syllable boundary */
      const nextSameSyl = i < word.length - 1 && letterToSyl[i + 1] === sylI;
      x += slotW + (nextSameSyl ? letterGap : groupGap);
    }

    ctx.textBaseline = 'alphabetic';
  }

  /* ── Flash overlay ─────────────────────────── */
  function _drawFlash(color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  /* ── Util ──────────────────────────────────── */
  function _roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ── Particles & screen shake ──────────────── */
  function _comboTier(combo) {
    if (combo >= 30) return 3;
    if (combo >= 15) return 2;
    if (combo >= 5)  return 1;
    return 0;
  }

  function triggerShake(intensity, ms) {
    if (intensity <= _shakeIntensity && _shakeTime > 0) return;
    _shakeIntensity = intensity;
    _shakeDuration  = ms;
    _shakeTime      = ms;
  }

  function _computeShakeOffset() {
    if (_shakeTime <= 0) return null;
    const t = _shakeTime / _shakeDuration;  /* 1 → 0 */
    const mag = _shakeIntensity * t;
    return { x: (Math.random() - 0.5) * 2 * mag, y: (Math.random() - 0.5) * 2 * mag };
  }

  /* Preset configs for emitBurst */
  const BURST_PRESETS = {
    letterHit: {
      count: 10, speedMin: 160, speedMax: 320, life: 0.45, gravity: 220,
      sizeMin: 3, sizeMax: 6, drag: 0.88,
      colors: ['#ffffff', '#7ed6ff', '#f5a623'],
    },
    wordSuccess: {
      count: 45, speedMin: 180, speedMax: 520, life: 1.1, gravity: 520,
      sizeMin: 4, sizeMax: 10, drag: 0.97,
      colors: ['#4caf50', '#7ed6ff', '#f5a623', '#ffd447', '#ffffff', '#ff6b9d'],
    },
    comboPulse: {
      count: 20, speedMin: 240, speedMax: 480, life: 0.6, gravity: 0,
      sizeMin: 3, sizeMax: 6, drag: 0.9,
      colors: ['#ffd447', '#ffffff'],
    },
  };

  function emitBurst(x, y, presetName) {
    const p = BURST_PRESETS[presetName];
    if (!p) return;
    const count = p.count;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = p.speedMin + Math.random() * (p.speedMax - p.speedMin);
      _particles.push({
        type:    'dot',
        x, y,
        vx:      Math.cos(angle) * speed,
        vy:      Math.sin(angle) * speed - (presetName === 'wordSuccess' ? 120 : 0),
        gravity: p.gravity,
        drag:    p.drag,
        life:    p.life,
        maxLife: p.life,
        size:    p.sizeMin + Math.random() * (p.sizeMax - p.sizeMin),
        color:   p.colors[(Math.random() * p.colors.length) | 0],
      });
    }
  }

  /* Shatter a falling item: 4×4 grid of image slices flying outward with rotation */
  function emitShatter(item) {
    const size = item.word.imageSize || 200;
    const cols = 4, rows = 4;
    const cx   = item.x, cy = item.y;
    const topLeftX = cx - size / 2, topLeftY = cy;
    const sliceW = (item.img ? item.img.width  : size) / cols;
    const sliceH = (item.img ? item.img.height : size) / rows;
    const dW = size / cols, dH = size / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pieceCx = topLeftX + c * dW + dW / 2;
        const pieceCy = topLeftY + r * dH + dH / 2;
        const dx = pieceCx - cx;
        const dy = pieceCy - cy - size * 0.2;  /* bias upward a touch */
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 220 + Math.random() * 260;
        _particles.push({
          type:    'slice',
          img:     item.img,
          emoji:   item.img ? null : item.word.emoji,
          sx:      c * sliceW, sy: r * sliceH, sw: sliceW, sh: sliceH,
          dw:      dW,         dh: dH,
          x:       pieceCx,    y:  pieceCy,
          vx:      (dx / dist) * speed + (Math.random() - 0.5) * 80,
          vy:      (dy / dist) * speed - 120 + (Math.random() - 0.5) * 60,
          gravity: 900,
          drag:    0.995,
          rot:     0,
          rotVel:  (Math.random() - 0.5) * 10,
          life:    1.2,
          maxLife: 1.2,
        });
      }
    }
  }

  function _updateAndDrawParticles() {
    const now = performance.now();
    const dt  = _particlesLastTs ? Math.min(0.05, (now - _particlesLastTs) / 1000) : 0;
    _particlesLastTs = now;

    if (_shakeTime > 0)       _shakeTime       = Math.max(0, _shakeTime       - dt * 1000);
    if (_tierBannerTime > 0)  _tierBannerTime  = Math.max(0, _tierBannerTime  - dt * 1000);

    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rotVel) p.rot += p.rotVel * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 100) { _particles.splice(i, 1); continue; }

      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = alpha;

      if (p.type === 'dot') {
        ctx.fillStyle   = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (p.type === 'slice') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.img) {
          ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
        } else if (p.emoji) {
          ctx.font = `${p.dw * 0.9}px serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.emoji, 0, 0);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function clearParticles() {
    _particles       = [];
    _shakeTime       = 0;
    _tierBarFill     = 0;
    _tierBannerText  = null;
    _tierBannerTime  = 0;
  }

  /* ── Tier progress bar (above input strip) ─── */
  function _drawTierBar(letterCombo) {
    /* Smooth the combo value for a natural fill animation */
    const now = performance.now();
    const dt  = _tierBarLastTs ? Math.min(0.05, (now - _tierBarLastTs) / 1000) : 0;
    _tierBarLastTs = now;
    _tierBarFill += (letterCombo - _tierBarFill) * (1 - Math.exp(-dt * 10));

    const barX = TIER_BAR_PAD_X;
    const barW = W - TIER_BAR_PAD_X * 2;
    const gap  = 5;
    const segW = (barW - gap * 4) / 5;
    const h    = TIER_BAR_H;
    const r    = h / 2;
    const y    = TIER_BAR_Y;

    const tier     = _tierFromCombo(_tierBarFill);
    const tierMin  = TIER_THRESHOLDS[tier - 1];
    const tierMax  = TIER_THRESHOLDS[tier];
    const progress = Math.max(0, Math.min(1, (_tierBarFill - tierMin) / (tierMax - tierMin)));

    for (let i = 1; i <= 5; i++) {
      const segX  = barX + (i - 1) * (segW + gap);
      const style = TIER_STYLES[i];
      /* Segment background */
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      _roundRect(segX, y, segW, h, r); ctx.fill();
      /* Outline */
      ctx.strokeStyle = style.dim;
      ctx.lineWidth = 1;
      _roundRect(segX, y, segW, h, r); ctx.stroke();
      /* Fill */
      let fill = 0;
      if (i < tier) fill = 1;
      else if (i === tier) fill = progress;
      if (fill > 0) {
        ctx.save();
        _roundRect(segX, y, segW, h, r); ctx.clip();
        ctx.fillStyle   = style.fill;
        ctx.shadowColor = style.fill;
        ctx.shadowBlur  = i === tier ? 10 : 4;
        ctx.fillRect(segX, y, segW * fill, h);
        ctx.restore();
        ctx.shadowBlur = 0;
      }
      /* Tiny ×N label centered in each segment */
      ctx.font      = 'bold 10px system-ui';
      ctx.fillStyle = (fill >= 1 || (i === tier && progress > 0.4))
        ? 'rgba(0,0,0,0.55)'
        : 'rgba(255,255,255,0.35)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${i}`, segX + segW / 2, y + h / 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /* ── Tier banner ("Nice!" / "Great!" / …) ─── */
  function triggerTierBanner(text, color) {
    _tierBannerText  = text;
    _tierBannerTime  = 1100;
    _tierBannerColor = color || '#ffffff';
  }

  function _drawTierBanner() {
    if (!_tierBannerText || _tierBannerTime <= 0) return;
    const total = 1100;
    const t     = _tierBannerTime / total;   /* 1 → 0 */
    const appear = 1 - t;                    /* 0 → 1 */
    const alpha  = t > 0.25 ? 1 : t / 0.25;  /* fade out at the end */
    const scale  = 0.7 + Math.min(1, appear * 3) * 0.45;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H * 0.42);
    ctx.scale(scale, scale);
    ctx.font         = 'bold 110px system-ui';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = _tierBannerColor;
    ctx.shadowBlur   = 36;
    ctx.fillStyle    = _tierBannerColor;
    ctx.fillText(_tierBannerText, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function getDangerY() { return DANGER_Y; }
  function getCanvasW() { return W; }
  function getSpawnY()  { return HUD_H + 20; }

  return {
    init, draw,
    setKeyboardVisible, highlightKey, resetKey, resetAllKeys,
    stripPushActive, stripUpdateTyped, stripWrongFlash, stripResolveActive, stripReset,
    emitBurst, emitShatter, triggerShake, triggerTierBanner, clearParticles,
    getDangerY, getCanvasW, getSpawnY,
  };
})();
