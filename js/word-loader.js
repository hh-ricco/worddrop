const WordLoader = (() => {
  /* Image cache: word → resolved URL or null */
  const imageCache = {};
  let giphyKey = '';

  function setGiphyKey(k) { giphyKey = k; }

  /* ── Load built-in manifest ────────────────── */
  async function loadManifest() {
    const r = await fetch('words/manifest.json');
    return r.json();
  }

  /* ── Load a YAML pack by path ──────────────── */
  async function loadPack(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Cannot load ${path}`);
    const text = await r.text();
    return jsyaml.load(text);
  }

  /* ── Parse a raw pack object into word list ── */
  function parsePack(raw, packId) {
    return (raw.words || []).map(w => {
      const word = w.word.toLowerCase();
      return {
        id:           `${packId}::${w.word}`,
        word,
        emoji:        w.emoji || '📝',
        imageFile:    w.image || null,
        imageSize:    w.image_size || raw.meta?.default_image_size || 200,
        difficulty:   w.difficulty || 1,
        translations: w.translations || {},
        tags:         w.tags || [],
        syllables:    Array.isArray(w.syllables) && w.syllables.length
          ? w.syllables.map(s => s.toLowerCase())
          : splitSyllables(word),
        packId,
        packName:     raw.meta?.name || packId,
      };
    });
  }

  /* ── Syllable splitter (heuristic, English) ──
     Not perfect, but handles most cases well enough for learning aid.
     Contributors can override with explicit `syllables:` in YAML. */
  function splitSyllables(word) {
    const w = word.toLowerCase();
    if (w.length <= 3) return [w];

    const vowels = new Set(['a','e','i','o','u','y']);
    const isV = c => vowels.has(c);

    /* Find indices that begin a new vowel group (vowel not preceded by vowel) */
    const starts = [];
    for (let i = 0; i < w.length; i++) {
      if (isV(w[i]) && !isV(w[i-1])) starts.push(i);
    }
    if (starts.length <= 1) return [w];

    /* Silent terminal 'e': drop only if not part of '-Cle' consonant-le ending */
    const lastStart = starts[starts.length - 1];
    const endsSilentE =
      w.endsWith('e') &&
      lastStart === w.length - 1 &&
      !(w.length >= 3 && w.endsWith('le') && !isV(w[w.length - 3]));
    if (endsSilentE) starts.pop();
    if (starts.length <= 1) return [w];

    const parts = [];
    let cursor = 0;
    for (let i = 1; i < starts.length; i++) {
      const prev = starts[i - 1];
      const curr = starts[i];
      /* end of previous vowel group */
      let pEnd = prev;
      while (pEnd + 1 < w.length && isV(w[pEnd + 1])) pEnd++;
      const cStart = pEnd + 1;
      const cCount = curr - cStart;
      const split  = cCount <= 1 ? cStart : cStart + 1;
      parts.push(w.slice(cursor, split));
      cursor = split;
    }
    parts.push(w.slice(cursor));
    return parts.filter(Boolean);
  }

  /* ── Resolve the image URL for a word ─────── */
  async function resolveImage(wordObj) {
    const key = wordObj.id;
    if (imageCache[key] !== undefined) return imageCache[key];

    /* 1. Contributor-specified image file — absolute paths (books/, http://, /) pass through */
    if (wordObj.imageFile) {
      const isRooted = /^(https?:\/\/|\/|books\/)/.test(wordObj.imageFile);
      const url = isRooted ? wordObj.imageFile : `words/images/${wordObj.imageFile}`;
      const ok = await _urlExists(url);
      if (ok) { imageCache[key] = url; return url; }
    }

    /* 2. Giphy API */
    if (giphyKey) {
      const query = encodeURIComponent(
        wordObj.word + (wordObj.tags[0] ? ' ' + wordObj.tags[0] : '')
      );
      try {
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${query}&limit=3&rating=g`
        );
        const json = await res.json();
        const gif = json?.data?.[0]?.images?.fixed_height?.url;
        if (gif) { imageCache[key] = gif; return gif; }
      } catch { /* fall through */ }
    }

    /* 3. Emoji fallback */
    imageCache[key] = null;
    return null;
  }

  async function _urlExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return r.ok;
    } catch { return false; }
  }

  /* ── Preload Image object ──────────────────── */
  function preloadImage(url) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  return { setGiphyKey, loadManifest, loadPack, parsePack, resolveImage, preloadImage };
})();
