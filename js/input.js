const Input = (() => {
  let onKey = null;

  function init(keyHandler) {
    onKey = keyHandler;
    window.addEventListener('keydown', _onPhysicalKey);
  }

  function destroy() {
    window.removeEventListener('keydown', _onPhysicalKey);
    onKey = null;
  }

  function _onPhysicalKey(e) {
    if (!onKey) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { onKey('ESCAPE'); return; }
    if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      e.preventDefault();
      onKey(e.key.toLowerCase());
    }
  }

  /* Called by virtual keyboard button clicks */
  function virtualKey(letter) {
    if (onKey) onKey(letter.toLowerCase());
  }

  return { init, destroy, virtualKey };
})();
