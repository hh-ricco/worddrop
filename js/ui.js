const UI = (() => {
  let settings = {};
  let onPackSelected = null;
  let onSettingsChanged = null;

  /* ── Screens ───────────────────────────────── */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
  }

  function showOverlay(name) {
    document.getElementById(`overlay-${name}`)?.classList.remove('hidden');
  }

  function hideOverlay(name) {
    document.getElementById(`overlay-${name}`)?.classList.add('hidden');
  }

  /* ── Init ──────────────────────────────────── */
  function init(s, packSelectedCb, settingsChangedCb) {
    settings = s;
    onPackSelected = packSelectedCb;
    onSettingsChanged = settingsChangedCb;

    _applyTheme(settings.theme);
    _bindHome();
    _bindSettings();
    _bindRecords();
    _bindPause();
  }

  /* ── Home mode selector ────────────────────── */
  function _bindHome() {
    document.querySelectorAll('.mode-card[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'drop')      { Records.saveLastMode('drop'); showScreen('start'); }
        else if (mode === 'book') { Book.openBookList(); }
      });
    });
    document.getElementById('btn-drop-back')?.addEventListener('click', () => showScreen('home'));
    document.getElementById('btn-book-list-back')?.addEventListener('click', () => showScreen('home'));
  }

  function renderHomeRecent() {
    const el   = document.getElementById('home-recent');
    if (!el) return;
    const last = Records.loadLastMode();
    if (!last) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const label = last.mode === 'book' ? 'Continue reading' : 'Continue typing';
    const title = last.mode === 'book'
      ? (last.detail?.bookTitle || 'Last book')
      : (last.detail?.packName  || 'Last pack');
    el.innerHTML = `
      <div>
        <div class="home-recent-label">${label}</div>
        <div class="home-recent-title">${title}</div>
      </div>
      <div class="home-recent-cta">→</div>
    `;
    el.onclick = () => {
      if (last.mode === 'book') Book.openBookList();
      else                       showScreen('start');
    };
  }

  /* ── Word Pack List ────────────────────────── */
  async function buildPackList(manifest, customPacks) {
    const container = document.getElementById('pack-list');
    container.innerHTML = '';

    const builtInByType = {};
    (manifest.packs || []).forEach(p => {
      (builtInByType[p.type] ??= []).push(p);
    });

    const typeLabels = { category: 'By Category', grade: 'By Grade', custom: 'My Packs' };

    for (const [type, packs] of Object.entries(builtInByType)) {
      _appendSectionTitle(container, typeLabels[type] || type);
      packs.forEach(pack => _appendPackCard(container, pack, false));
    }

    if (customPacks.length > 0) {
      _appendSectionTitle(container, 'My Custom Packs');
      customPacks.forEach(pack => {
        _appendPackCard(container, {
          id:   pack.meta.id,
          name: pack.meta.name,
          icon: pack.meta.icon || '⭐',
          type: 'custom',
          _raw: pack,
        }, true);
      });
    }

    /* Auto pack: words graduated from Book mode */
    const bookMetaById = Object.fromEntries(
      (window._booksManifest?.books || []).map(b => [b.id, b])
    );
    const autoPack = Records.getBooksAutoPack(bookMetaById);
    if (autoPack.words.length > 0) {
      _appendSectionTitle(container, 'From Books');
      _appendPackCard(container, {
        id:   autoPack.meta.id,
        name: `${autoPack.meta.name} · ${autoPack.words.length} words`,
        icon: autoPack.meta.icon,
        type: 'from-books',
        _raw: autoPack,
      }, true);
    }
  }

  function _appendSectionTitle(container, label) {
    const el = document.createElement('div');
    el.className = 'pack-section-title';
    el.textContent = label;
    container.appendChild(el);
  }

  function _appendPackCard(container, pack, isCustom) {
    const card = document.createElement('button');
    card.className = 'pack-card';
    card.innerHTML = `
      <span class="pack-icon">${pack.icon || '📦'}</span>
      <div class="pack-info">
        <div class="pack-name">${pack.name}</div>
        <div class="pack-meta">${pack.type}</div>
      </div>
      ${isCustom ? '<span class="pack-badge custom">Custom</span>' : ''}
    `;
    card.addEventListener('click', () => onPackSelected?.(pack));
    container.appendChild(card);
  }

  /* ── Settings ──────────────────────────────── */
  function _bindSettings() {
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      _populateSettings();
      showOverlay('settings');
    });
    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      _populateSettings();
      hideOverlay('pause');
      showOverlay('settings');
    });
    document.getElementById('btn-settings-close')?.addEventListener('click', () => {
      _readSettings();
      hideOverlay('settings');
    });

    /* Custom pack upload */
    document.getElementById('set-upload-pack')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const pack = jsyaml.load(text);
        if (!pack?.meta?.id) throw new Error('Missing meta.id');
        Records.saveCustomPack(pack);
        alert(`Pack "${pack.meta.name || pack.meta.id}" uploaded!`);
        _renderCustomPackList();
        onSettingsChanged?.(settings);
      } catch (err) {
        alert(`Invalid YAML: ${err.message}`);
      }
      e.target.value = '';
    });
  }

  function _populateSettings() {
    _set('set-translation', settings.translationLang);
    _set('set-keyboard',    settings.showKeyboard, 'check');
    _set('set-accent',      settings.accent || 'us');
    _set('set-tts',         settings.ttsEnabled,   'check');
    _set('set-spell-on-miss', settings.spellOnMiss, 'check');
    _set('set-tts-speed',   settings.ttsSpeed);
    _set('set-sfx',         settings.sfxEnabled,   'check');
    _set('set-bgm',         settings.bgmEnabled,   'check');
    _set('set-volume',      settings.volume);
    _set('set-speed',       settings.speed);
    _set('set-theme',       settings.theme);
    _set('set-giphy-key',   settings.giphyKey || '');
    _renderCustomPackList();
  }

  function _readSettings() {
    settings.translationLang = _get('set-translation');
    settings.showKeyboard    = _get('set-keyboard', 'check');
    settings.accent          = _get('set-accent');
    settings.ttsEnabled      = _get('set-tts',      'check');
    settings.spellOnMiss     = _get('set-spell-on-miss', 'check');
    settings.ttsSpeed        = parseFloat(_get('set-tts-speed'));
    settings.sfxEnabled      = _get('set-sfx',      'check');
    settings.bgmEnabled      = _get('set-bgm',      'check');
    settings.volume          = parseFloat(_get('set-volume'));
    settings.speed           = _get('set-speed');
    settings.theme           = _get('set-theme');
    settings.giphyKey        = _get('set-giphy-key').trim();
    _applyTheme(settings.theme);
    Records.saveSettings(settings);
    onSettingsChanged?.(settings);
  }

  function _renderCustomPackList() {
    const container = document.getElementById('custom-pack-list');
    if (!container) return;
    const packs = Records.loadCustomPacks();
    container.innerHTML = packs.map(p => `
      <div class="custom-pack-item">
        <span>${p.meta.icon || '⭐'} ${p.meta.name || p.meta.id}</span>
        <button onclick="Records.removeCustomPack('${p.meta.id}');UI.refreshCustomList();" style="background:none;border:none;color:#f44336;cursor:pointer;">✕</button>
      </div>
    `).join('');
  }

  function refreshCustomList() { _renderCustomPackList(); }

  function _applyTheme(theme) {
    document.body.dataset.theme = theme || 'dark';
  }

  function _set(id, val, type) {
    const el = document.getElementById(id);
    if (!el) return;
    if (type === 'check') el.checked = !!val;
    else el.value = val ?? '';
  }

  function _get(id, type) {
    const el = document.getElementById(id);
    if (!el) return type === 'check' ? false : '';
    return type === 'check' ? el.checked : el.value;
  }

  /* ── Records screen ────────────────────────── */
  function _bindRecords() {
    document.getElementById('btn-open-records')?.addEventListener('click', () => {
      _renderRecords();
      showScreen('records');
    });
    document.getElementById('btn-records-back')?.addEventListener('click', () => {
      showScreen('home');
    });
    document.getElementById('btn-export-data')?.addEventListener('click', () => {
      Records.exportAll();
    });
    document.getElementById('btn-reset-data')?.addEventListener('click', () => {
      if (confirm('Reset all progress? This cannot be undone.')) {
        Records.resetAll();
        _renderRecords();
      }
    });
  }

  function _renderRecords() {
    const stats = Records.getStats();
    document.getElementById('rec-streak').textContent  = stats.streak;
    document.getElementById('rec-total').textContent   = stats.totalWords;
    document.getElementById('rec-sessions').textContent = stats.sessions;

    /* Calendar (last 35 days) */
    const cal = document.getElementById('rec-calendar');
    cal.innerHTML = '';
    const today = new Date();
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const div = document.createElement('div');
      div.className = 'rec-day' +
        (stats.allDates.includes(ds) ? ' active' : '') +
        (i === 0 ? ' today' : '');
      div.title = ds;
      cal.appendChild(div);
    }

    /* Weak words */
    const ww = document.getElementById('rec-weak-words');
    ww.innerHTML = stats.weakWords.map(r => `
      <div class="rec-weak-item">
        <span>${r.wordId}</span>
        <span class="error-count">${r.letterErrors} errors</span>
      </div>
    `).join('') || '<div style="color:var(--text-dim);font-size:.85rem;">No errors yet — keep playing!</div>';
  }

  /* ── Pause overlay ─────────────────────────── */
  function _bindPause() {
    /* Pause button is now drawn on canvas — only bind the overlay controls */
    document.getElementById('btn-resume')?.addEventListener('click', () => window.Game?.resume());
    document.getElementById('btn-end-session')?.addEventListener('click', () => {
      hideOverlay('pause');
      window.Game?.endSession();
    });
  }

  /* ── Summary screen ────────────────────────── */
  function showSummary(result) {
    document.getElementById('sum-score').textContent    = result.score;
    document.getElementById('sum-words').textContent    = result.wordsStudied;
    document.getElementById('sum-accuracy').textContent = result.accuracy + '%';
    document.getElementById('sum-streak').textContent   = result.maxStreak;

    const list = document.getElementById('sum-word-list');
    list.innerHTML = (result.wordResults || []).map(w => `
      <div class="sum-word-item ${w.success ? 'success' : 'miss'}">
        <span class="word-result-icon">${w.success ? '✅' : '❌'}</span>
        <span>${w.word}</span>
        <span style="color:var(--text-dim);font-size:.8rem;margin-left:auto;">${w.errors} errors</span>
      </div>
    `).join('');

    document.getElementById('btn-play-again')?.addEventListener('click', () => window.Game?.restart(), { once: true });
    document.getElementById('btn-back-home')?.addEventListener('click', () => {
      showScreen('home');
    }, { once: true });

    showScreen('summary');
  }

  return {
    init, showScreen, showOverlay, hideOverlay,
    buildPackList, showSummary, refreshCustomList,
    renderHomeRecent,
  };
})();
