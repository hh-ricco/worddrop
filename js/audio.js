const Audio = (() => {
  let settings = null;
  let successSound = null;
  let failSound = null;
  let bgm = null;
  let bgmPlaying = false;

  /* Cache: "word::accent" → { audio: HTMLAudioElement, ready: Promise<boolean> } */
  const audioCache = {};

  /* Currently playing non-cached <audio> (for speak/stopSpeech) */
  let _currentSpeak = null;

  /* Loaded TTS voices (populated once on first use, fallback only) */
  let voicesReady = false;
  let cachedVoices = [];

  const YOUDAO_TTS = 'https://dict.youdao.com/dictvoice';

  /* ── Init ──────────────────────────────────── */
  function init(s) {
    settings = s;

    if (window.speechSynthesis) {
      const load = () => {
        cachedVoices = window.speechSynthesis.getVoices();
        if (cachedVoices.length > 0) voicesReady = true;
      };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }

    if (typeof Howl !== 'undefined') {
      successSound = new Howl({ src: ['assets/sounds/success.mp3'], volume: 0.7, onloaderror: () => {} });
      failSound    = new Howl({ src: ['assets/sounds/fail.mp3'],    volume: 0.5, onloaderror: () => {} });
      bgm = new Howl({ src: ['assets/sounds/bgm.mp3'], loop: true, volume: 0.25, onloaderror: () => { bgm = null; } });
    }
  }

  function _vol() { return settings?.volume ?? 0.8; }

  function _accent() { return settings?.accent === 'gb' ? 'gb' : 'us'; }

  function _ttsUrl(word, accent) {
    /* Youdao: type=1 = UK, type=2 = US */
    const type = accent === 'gb' ? 1 : 2;
    const q    = encodeURIComponent(word);
    return `${YOUDAO_TTS}?audio=${q}&type=${type}`;
  }

  /* ── Prefetch Google TTS audio (call before word appears on screen) */
  function prefetchWord(word) {
    const accent = _accent();
    const key = `${word}::${accent}`;
    if (audioCache[key]) return audioCache[key].ready;

    const audio = new window.Audio(_ttsUrl(word, accent));
    audio.preload = 'auto';

    const ready = new Promise(resolve => {
      const done = v => resolve(v);
      audio.addEventListener('canplaythrough', () => done(true),  { once: true });
      audio.addEventListener('loadeddata',     () => done(true),  { once: true });
      audio.addEventListener('error',          () => done(false), { once: true });
      /* Safety: if neither fires within 3s (CORS / network hang), fall back */
      setTimeout(() => done(false), 3000);
    });

    audioCache[key] = { audio, ready };
    return ready;
  }

  /* ── Play a word (uses cached Google TTS, falls back to Web Speech) */
  async function speakWord(word) {
    if (!settings?.ttsEnabled) return;

    const accent = _accent();
    const lang   = accent === 'gb' ? 'en-GB' : 'en-US';
    const key    = `${word}::${accent}`;

    let entry = audioCache[key];
    if (!entry) {
      prefetchWord(word);
      entry = audioCache[key];
    }

    const ok = await entry.ready;
    if (ok) {
      window.speechSynthesis?.cancel();
      try {
        entry.audio.currentTime = 0;
        entry.audio.volume = _vol();
        entry.audio.play().catch(() => _tts(word, settings?.ttsSpeed ?? 0.85, lang));
      } catch {
        _tts(word, settings?.ttsSpeed ?? 0.85, lang);
      }
    } else {
      _tts(word, settings?.ttsSpeed ?? 0.85, lang);
    }
  }

  /* ── Speak arbitrary text, resolves on ended (used for letter-by-letter spelling) */
  function speak(text) {
    if (!settings?.ttsEnabled || !text) return Promise.resolve();

    const accent = _accent();
    const lang   = accent === 'gb' ? 'en-GB' : 'en-US';
    const url    = _ttsUrl(text, accent);

    return new Promise(resolve => {
      const a = new window.Audio(url);
      a.volume = _vol();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (_currentSpeak?.audio === a) _currentSpeak = null;
        resolve();
      };
      _currentSpeak = { audio: a, finish };

      a.addEventListener('ended', finish, { once: true });
      a.addEventListener('error', () => {
        _tts(text, settings?.ttsSpeed ?? 0.85, lang);
        setTimeout(finish, 400 + text.length * 90);
      }, { once: true });

      try {
        a.play().catch(() => {
          _tts(text, settings?.ttsSpeed ?? 0.85, lang);
          setTimeout(finish, 400 + text.length * 90);
        });
      } catch {
        _tts(text, settings?.ttsSpeed ?? 0.85, lang);
        setTimeout(finish, 400 + text.length * 90);
      }

      /* Hard safety timeout */
      setTimeout(finish, 4000);
    });
  }

  /* ── Interrupt any ongoing speak() / _tts() ── */
  function stopSpeech() {
    window.speechSynthesis?.cancel();
    if (_currentSpeak) {
      try { _currentSpeak.audio.pause(); } catch {}
      _currentSpeak.finish();
    }
  }

  /* ── Web Speech API fallback ───────────────── */
  function _tts(text, rate, lang) {
    if (!window.speechSynthesis || !text) return;

    const preferred = lang === 'en-GB'
      ? ['Daniel', 'Kate', 'Arthur', 'Oliver']
      : ['Samantha', 'Alex', 'Karen', 'Moira', 'Microsoft David', 'Microsoft Zira'];

    let voice = null;
    if (voicesReady) {
      voice = preferred.reduce((found, name) =>
        found || cachedVoices.find(v => v.name.includes(name) && v.lang.startsWith('en')) || null
      , null)
        || cachedVoices.find(v => v.lang === lang)
        || cachedVoices.find(v => v.lang.startsWith('en'))
        || null;
    }

    /* Chrome bug: cancel() immediately followed by speak() fails silently
       when nothing was previously speaking. A short delay lets the engine settle. */
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang   = lang || 'en-US';
      u.rate   = rate ?? 0.85;
      u.volume = _vol();
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    }, 50);
  }

  /* ── Per-letter pentatonic blip (Web Audio) ─
     Gives each correct keystroke a note rising through the word,
     so a full word sounds like a short melody. */
  let _audioCtx = null;
  const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50]; /* C5 D5 E5 G5 A5 C6 */

  function playKeyBlip(letterIndex = 0) {
    if (!settings?.sfxEnabled) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx  = _audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const now  = ctx.currentTime;
      const freq = PENTATONIC[Math.min(PENTATONIC.length - 1, letterIndex)];
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      const peak = Math.max(0.0001, _vol() * 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak,    now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch { /* no-op */ }
  }

  /* ── Sound effects ─────────────────────────── */
  function playSuccess() {
    if (!settings?.sfxEnabled) return;
    if (successSound) { successSound.volume(_vol() * 0.7); successSound.play(); }
  }

  function playFail() {
    if (!settings?.sfxEnabled) return;
    if (failSound) { failSound.volume(_vol() * 0.5); failSound.play(); }
  }

  /* ── BGM ───────────────────────────────────── */
  function startBGM() {
    if (!settings?.bgmEnabled || !bgm || bgmPlaying) return;
    bgm.volume(_vol() * 0.25);
    bgm.play();
    bgmPlaying = true;
  }

  function stopBGM() {
    if (!bgm || !bgmPlaying) return;
    bgm.stop();
    bgmPlaying = false;
  }

  function updateVolume(vol) {
    if (bgm && bgmPlaying) bgm.volume(vol * 0.25);
    if (successSound) successSound.volume(vol * 0.7);
    if (failSound) failSound.volume(vol * 0.5);
  }

  return { init, speakWord, speak, stopSpeech, prefetchWord, playSuccess, playFail, playKeyBlip, startBGM, stopBGM, updateVolume };
})();
