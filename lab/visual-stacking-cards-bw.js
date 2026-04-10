(function initStackToneToggle() {
  var body = document.body;
  var toggle = document.getElementById('toneToggle');
  var modeChip = document.querySelector('.stack-mode-chip');

  if (!body || !toggle) {
    return;
  }

  var setMode = function setMode(mode) {
    var isColor = mode === 'color';

    body.classList.toggle('is-color', isColor);
    body.setAttribute('data-tone-mode', isColor ? 'color' : 'bw');
    toggle.textContent = isColor ? 'Black & White' : 'Return to color';
    toggle.setAttribute('aria-pressed', String(isColor));

    if (modeChip) {
      modeChip.textContent = isColor ? 'Rainbow variant' : 'Monochrome Variant';
    }
  };

  setMode('bw');

  toggle.addEventListener('click', function onToggleClick() {
    var nextMode = body.getAttribute('data-tone-mode') === 'color' ? 'bw' : 'color';
    setMode(nextMode);
  });
})();
