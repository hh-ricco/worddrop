const BookLoader = (() => {

  async function loadManifest() {
    const r = await fetch('books/manifest.json');
    return r.json();
  }

  async function loadBook(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`Cannot load ${path}`);
    const text = await r.text();
    const raw  = jsyaml.load(text);
    return parseBook(raw);
  }

  function parseBook(raw) {
    const meta = raw.meta || {};
    const pages = (raw.pages || []).map((p, i) => {
      /* Split text into tokens keeping punctuation attached; each token is either
         a word (possibly with trailing punctuation) or a whitespace marker.
         `keyWords` is a lowercase set used for cloze matching. */
      const keyWords = new Set((p.key_words || []).map(w => w.toLowerCase()));
      const tokens = _tokenize(p.text || '');
      tokens.forEach(t => {
        if (t.type === 'word') {
          t.isKey = keyWords.has(t.word.toLowerCase());
        }
      });
      return {
        index: i,
        image:    p.image || '📖',
        text:     p.text  || '',
        keyWords: [...keyWords],
        tokens,
        audio:    p.audio || null,   /* optional pre-recorded audio path */
      };
    });
    return { meta, pages };
  }

  /* Split "I see a red apple." into
     [{type:'word', word:'I', trailing:''}, {type:'space'},
      {type:'word', word:'see', trailing:''}, ... ,
      {type:'word', word:'apple', trailing:'.'}] */
  function _tokenize(text) {
    const out  = [];
    const re   = /([A-Za-z'’\-]+)([^A-Za-z'’\-\s]*)(\s*)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, word, trailing, space] = m;
      if (word) out.push({ type: 'word', word, trailing: trailing || '' });
      if (space) out.push({ type: 'space' });
    }
    return out;
  }

  return { loadManifest, loadBook };
})();
