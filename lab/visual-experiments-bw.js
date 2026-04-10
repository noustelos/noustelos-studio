(function initVisualExperimentToneToggle() {
  var body = document.body;
  var toggle = document.getElementById('toneToggle');
  var modeChip = document.querySelector('.visual-mode-chip');
  var currentLang = localStorage.getItem('siteLanguage') === 'gr' ? 'gr' : 'en';

  var labels = {
    en: {
      toColor: 'Return to color',
      toBw: 'Black & White',
      chipBw: 'Monochrome Variant',
      chipColor: 'Color Variant'
    },
    gr: {
      toColor: 'Επιστροφη σε χρωμα',
      toBw: 'Ασπρομαυρο',
      chipBw: 'Μονοχρωμη εκδοση',
      chipColor: 'Εγχρωμη εκδοση'
    }
  };

  if (!body || !toggle) {
    return;
  }

  var setMode = function setMode(mode) {
    var isColor = mode === 'color';

    body.classList.toggle('is-color', isColor);
    body.setAttribute('data-tone-mode', isColor ? 'color' : 'bw');
    toggle.textContent = isColor ? labels[currentLang].toBw : labels[currentLang].toColor;
    toggle.setAttribute('aria-pressed', String(isColor));

    if (modeChip) {
      modeChip.textContent = isColor ? labels[currentLang].chipColor : labels[currentLang].chipBw;
    }
  };

  setMode('bw');

  toggle.addEventListener('click', function onToggleClick() {
    var nextMode = body.getAttribute('data-tone-mode') === 'color' ? 'bw' : 'color';
    setMode(nextMode);
  });
})();
