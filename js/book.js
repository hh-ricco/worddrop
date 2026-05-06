/* ═══════════════════════════════════════════════════
   book.js — Book mode (Read + Cloze) reader
═══════════════════════════════════════════════════ */
const Book = (() => {

  let manifest     = null;
  let currentBook  = null;   /* { meta, pages } — pages[i].clean is set when cloze finished with 0 errors */
  let pageIndex    = 0;
  let mode         = 'read'; /* 'read' | 'cloze' */
  let clozeState   = null;   /* { blanks: [{tokenIdx, word, typed, done, errorCount}], activeBlank } */
  let pageErrored  = false;  /* did the player make any wrong keystroke on the current cloze page */

  let bookMetaById = {};

  async function init() {
    manifest = await BookLoader.loadManifest();
    bookMetaById = Object.fromEntries((manifest.books || []).map(b => [b.id, b]));
    _bindControls();
  }

  function openBookList() {
    UI.showScreen('book-list');
    const container = document.getElementById('book-list');
    container.innerHTML = '';
    const bp = Records.loadBookProgress();
    (manifest.books || []).forEach(bookMeta => {
      const card = document.createElement('button');
      card.className = 'book-card';
      const progress = bp[bookMeta.id];
      const seenPages = progress
        ? Object.keys(progress.readPages || {}).length + Object.keys(progress.clozePages || {}).length
        : 0;
      card.innerHTML = `
        <div class="book-cover">${bookMeta.cover || '📖'}</div>
        <div class="book-title">${bookMeta.title}</div>
        <div class="book-meta">Level ${bookMeta.level} · ${bookMeta.pageCount} pages${seenPages ? ' · started' : ''}</div>
      `;
      card.addEventListener('click', () => openBook(bookMeta));
      container.appendChild(card);
    });
  }

  async function openBook(bookMeta) {
    currentBook = await BookLoader.loadBook(bookMeta.path);
    currentBook.meta = { ...bookMeta, ...currentBook.meta };
    pageIndex   = 0;
    mode        = 'read';
    pageErrored = false;
    clozeState  = null;

    Records.saveLastMode('book', { bookId: bookMeta.id, bookTitle: bookMeta.title });

    document.getElementById('reader-title').textContent = currentBook.meta.title;
    _syncModePills();
    UI.showScreen('book-reader');
    _renderPage();
    /* Kick off audio for the first page (no click required — user already chose the book) */
    setTimeout(_playPageAudio, 400);
  }

  function _bindControls() {
    document.getElementById('btn-reader-back')?.addEventListener('click', openBookList);
    document.getElementById('btn-reader-prev')?.addEventListener('click', () => _go(-1));
    document.getElementById('btn-reader-next')?.addEventListener('click', () => _go(+1));
    document.getElementById('btn-reader-listen')?.addEventListener('click', _playPageAudio);

    document.querySelectorAll('.mode-pill[data-reader-mode]').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.readerMode));
    });
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    _syncModePills();
    _renderPage();
  }

  function _syncModePills() {
    document.querySelectorAll('.mode-pill[data-reader-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.readerMode === mode);
    });
  }

  function _renderPage() {
    if (!currentBook) return;
    const page = currentBook.pages[pageIndex];
    if (!page) return;

    document.getElementById('reader-progress').textContent =
      `${pageIndex + 1}/${currentBook.pages.length}`;

    const pageEl = document.getElementById('reader-page');
    pageEl.innerHTML = '';

    /* Image / emoji */
    const imgWrap = document.createElement('div');
    imgWrap.className = 'reader-image';
    if (page.image && page.image.startsWith('books/')) {
      const img = document.createElement('img');
      img.src = page.image;
      img.alt = '';
      imgWrap.appendChild(img);
    } else {
      imgWrap.textContent = page.image || '📖';
    }
    pageEl.appendChild(imgWrap);

    /* Text */
    const textEl = document.createElement('div');
    textEl.className = 'reader-text';
    if (mode === 'cloze') _buildClozeDOM(textEl, page);
    else                  _buildReadDOM(textEl, page);
    pageEl.appendChild(textEl);

    /* Per-page "clean cloze" flower — only on pages the player completed with zero wrong keystrokes */
    const streakEl = document.createElement('div');
    streakEl.className = 'reader-quiet-streak';
    if (page.clean) streakEl.innerHTML = `<span class="bloom">🌼</span>`;
    pageEl.appendChild(streakEl);

    Records.recordBookPage(currentBook.meta.id, pageIndex, mode);
  }

  function _buildReadDOM(container, page) {
    page.tokens.forEach(t => {
      if (t.type === 'space') { container.appendChild(document.createTextNode(' ')); return; }
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = t.word + t.trailing;
      container.appendChild(span);
    });
  }

  function _buildClozeDOM(container, page) {
    clozeState  = { blanks: [], activeBlank: 0 };
    pageErrored = false;

    page.tokens.forEach((t, idx) => {
      if (t.type === 'space') { container.appendChild(document.createTextNode(' ')); return; }
      const span = document.createElement('span');
      span.className = 'word';
      if (t.isKey) {
        span.classList.add('cloze');
        span.dataset.tokenIdx = String(idx);
        span.textContent = '_'.repeat(t.word.length);
        clozeState.blanks.push({
          tokenIdx: idx,
          word: t.word,
          typed: '',
          trailing: t.trailing,
          done: false,
          el: span,
        });
      } else {
        span.textContent = t.word + t.trailing;
      }
      container.appendChild(span);
    });

    _refreshClozeHighlight();
  }

  function _refreshClozeHighlight() {
    if (!clozeState) return;
    clozeState.blanks.forEach((b, i) => {
      b.el.classList.toggle('current', i === clozeState.activeBlank && !b.done);
      b.el.classList.toggle('done',    b.done);
    });
  }

  function _renderClozeTyped(blank) {
    const typed     = blank.typed;
    const remaining = '_'.repeat(blank.word.length - typed.length);
    blank.el.textContent = typed + remaining + (blank.done ? blank.trailing : '');
  }

  function onKey(letter) {
    if (mode !== 'cloze' || !clozeState) return;
    const blank = clozeState.blanks[clozeState.activeBlank];
    if (!blank || blank.done) return;

    const expected = blank.word[blank.typed.length];
    if (!expected) return;

    if (letter.toLowerCase() === expected.toLowerCase()) {
      blank.typed += expected;
      _renderClozeTyped(blank);
      if (blank.typed.length >= blank.word.length) {
        blank.done = true;
        _renderClozeTyped(blank);
        /* SM-2 record: one update per completed word. Quality based on errors. */
        const errs  = blank.errorCount || 0;
        const q     = errs === 0 ? 5 : errs <= 2 ? 4 : 3;
        _recordAttempt(blank.word, q);
        clozeState.activeBlank++;
        _refreshClozeHighlight();
        if (clozeState.activeBlank >= clozeState.blanks.length) {
          _onAllBlanksFilled();
        }
      }
    } else {
      /* Wrong key: flash + this page is no longer "clean". Count toward this blank's error tally. */
      blank.el.style.background = 'rgba(244,67,54,0.3)';
      setTimeout(() => { blank.el.style.background = ''; }, 220);
      blank.errorCount = (blank.errorCount || 0) + 1;
      pageErrored = true;
    }
  }

  function _onAllBlanksFilled() {
    /* Mark this page clean only if the player made zero wrong keystrokes while on it */
    const page = currentBook?.pages[pageIndex];
    if (page) page.clean = !pageErrored;
    setTimeout(() => _go(+1), 450);
  }

  function _recordAttempt(word, quality) {
    const progress = Records.loadProgress();
    const packId   = `book::${currentBook.meta.id}`;
    const rec = Records.getRecord(progress, packId, word.toLowerCase());
    /* Stash book context so auto-pack can reconstruct a nice card later */
    const page = currentBook.pages[pageIndex];
    rec.image    = page?.image && page.image.startsWith('books/') ? page.image : null;
    rec.emoji    = page?.image && !page.image.startsWith('books/') ? page.image : null;
    rec.sentence = page?.text || '';
    Records.updateRecord(progress, rec, quality, Records.loadTurn());
    Records.incrementTurn();
  }

  async function _go(delta) {
    if (!currentBook) return;
    const next = pageIndex + delta;
    if (next < 0) return;
    if (next >= currentBook.pages.length) {
      _onBookComplete();
      return;
    }

    const pageEl = document.getElementById('reader-page');
    pageEl.classList.add(delta > 0 ? 'slide-out-left' : 'slide-out-right');
    await _sleep(260);
    pageIndex = next;
    pageEl.classList.remove('slide-out-left', 'slide-out-right');
    pageEl.classList.add(delta > 0 ? 'slide-in-right' : 'slide-in-left');
    _renderPage();
    /* next frame — remove slide-in so it transitions to rest */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pageEl.classList.remove('slide-in-right', 'slide-in-left');
      if (mode === 'read') setTimeout(_playPageAudio, 150);
    }));
  }

  function _onBookComplete() {
    const pageEl = document.getElementById('reader-page');
    pageEl.innerHTML = `
      <div class="reader-image">🎉</div>
      <div class="reader-text">
        ${mode === 'cloze'
          ? 'You finished the practice! Words you got right are saved for typing drills.'
          : 'The end. Tap <b>Practice</b> to try the cloze version.'}
      </div>
    `;
    document.getElementById('reader-progress').textContent =
      `${currentBook.pages.length}/${currentBook.pages.length}`;
  }

  function _playPageAudio() {
    if (!currentBook) return;
    const page = currentBook.pages[pageIndex];
    if (!page) return;
    /* Prefer pre-recorded audio when a book ships one; otherwise Youdao TTS of the sentence. */
    if (page.audio) {
      try {
        const a = new window.Audio(page.audio);
        a.volume = 0.9;
        a.play().catch(() => Audio.speak(page.text));
      } catch {
        Audio.speak(page.text);
      }
    } else {
      Audio.speak(page.text);
    }
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* Physical keyboard — route only when the book-reader screen is active */
  window.addEventListener('keydown', e => {
    if (!document.getElementById('screen-book-reader')?.classList.contains('active')) return;
    if (e.key === 'ArrowRight') { _go(+1); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft')  { _go(-1); e.preventDefault(); return; }
    if (e.key === 'Escape')     { openBookList(); e.preventDefault(); return; }
    if (mode === 'cloze' && /^[A-Za-z]$/.test(e.key)) {
      onKey(e.key);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  function getManifest() { return manifest; }

  return { init, openBookList, openBook, setMode, onKey, getManifest };
})();

window.Book = Book;
