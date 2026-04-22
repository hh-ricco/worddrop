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
      score, streak, speedLabel,
      settings, flashOverlay,
    } = state;

    const spelling = gameState === 'spelling';
    _spelling      = spelling;
    _spellingPhase = spellCtx?.phase || null;

    ctx.clearRect(0, 0, W, H);
    _drawBackground();
    _drawHUD(score, streak, speedLabel);
    _drawDangerLine();

    fallingItems.forEach(item => {
      _drawFallingItem(item, activeItem && item.word.id === activeItem.word.id, settings);
    });

    _drawInputStrip();
    if (flashOverlay)           _drawFlash(flashOverlay.color, flashOverlay.alpha);
    if (spelling && spellCtx)   _drawSpellingCard(spellCtx);

    /* Keyboard drawn last so it sits on top of the review card during typing */
    const kbVisible = _showKeyboard && (!spelling || spellCtx?.phase === 'typing');
    if (kbVisible) _drawKeyboard(typingState?.target);
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
  function _drawHUD(score, streak, speedLabel) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, HUD_H);

    /* Score */
    ctx.font = 'bold 38px system-ui';
    ctx.fillStyle = '#e8e8f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${score}`, 30, HUD_H / 2);

    /* Streak */
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui';
    ctx.fillStyle = streak > 1 ? '#f5a623' : 'transparent';
    ctx.fillText(`🔥 ×${streak}`, W / 2, HUD_H / 2);

    /* Speed label */
    ctx.textAlign = 'right';
    ctx.font = '20px system-ui';
    ctx.fillStyle = '#8888aa';
    ctx.fillText(speedLabel || '', W - 100, HUD_H / 2);

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
  function _drawFallingItem(item, isActive, settings) {
    const { word, x, y, img, shakeOffset, freezeTimer } = item;
    const size   = word.imageSize || 200;
    const cx     = x + shakeOffset;
    const frozen = freezeTimer > 0;

    ctx.globalAlpha = isActive ? 1 : 0.4;
    if (frozen)         { ctx.shadowColor = '#7ed6ff'; ctx.shadowBlur = 28; }
    else if (isActive)  { ctx.shadowColor = '#e94560'; ctx.shadowBlur = 24; }

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

  function getDangerY() { return DANGER_Y; }
  function getCanvasW() { return W; }
  function getSpawnY()  { return HUD_H + 20; }

  return {
    init, draw,
    setKeyboardVisible, highlightKey, resetKey, resetAllKeys,
    stripPushActive, stripUpdateTyped, stripWrongFlash, stripResolveActive, stripReset,
    getDangerY, getCanvasW, getSpawnY,
  };
})();
