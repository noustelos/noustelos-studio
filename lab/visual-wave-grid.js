(function initWaveGrid() {
  var settings = {
    gap: 40,
    radiusVmin: 30,
    speedIn: 0.5,
    speedOut: 0.6,
    restScale: 0.09,
    minHoverScale: 1,
    maxHoverScale: 3,
    waveSpeed: 1200,
    waveWidth: 180
  };

  var PALETTE = [
    { type: 'solid', value: '#f5f5f5' },
    { type: 'solid', value: '#d9d9d9' },
    { type: 'solid', value: '#c4c4c4' },
    { type: 'solid', value: '#b0b0b0' },
    { type: 'solid', value: '#9b9b9b' },
    { type: 'solid', value: '#858585' },
    { type: 'solid', value: '#707070' },
    { type: 'solid', value: '#5c5c5c' },
    { type: 'solid', value: '#474747' },
    { type: 'solid', value: '#333333' },
    { type: 'gradient', stops: ['#ffffff', '#bdbdbd'] },
    { type: 'gradient', stops: ['#e5e5e5', '#8f8f8f'] },
    { type: 'gradient', stops: ['#d0d0d0', '#5f5f5f'] },
    { type: 'gradient', stops: ['#bdbdbd', '#2f2f2f'] },
    { type: 'gradient', stops: ['#f2f2f2', '#6e6e6e'] },
    { type: 'gradient', stops: ['#cfcfcf', '#3f3f3f'] },
    { type: 'gradient', stops: ['#9f9f9f', '#1f1f1f'] }
  ];

  var SHAPE_TYPES = ['circle', 'pill', 'star', 'star'];

  var canvas = document.querySelector('.wave-canvas');
  if (!canvas) {
    return;
  }

  var ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  var triggerCenterButton = document.getElementById('triggerCenterWave');
  var triggerRandomButton = document.getElementById('triggerRandomWave');
  var densityInput = document.getElementById('gridDensity');
  var densityValue = document.getElementById('gridDensityValue');
  var speedInput = document.getElementById('waveVelocity');
  var speedValue = document.getElementById('waveVelocityValue');

  var grid = null;
  var rafId = null;
  var pointer = null;
  var activity = 0;
  var waves = [];
  var maskRects = [];
  var frameCount = 0;
  var maskOverride = false;
  var maskTimeoutId = 0;
  var resizeRafId = 0;
  var isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  var hasUserDensityOverride = false;

  function rnd(min, max) { return Math.random() * (max - min) + min; }
  function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function smoothstep(t) {
    var c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  function durationToFactor(seconds) {
    if (seconds <= 0) return 1;
    return 1 - Math.pow(0.05, 1 / (60 * seconds));
  }

  function getQualityProfile(viewport) {
    var width = viewport.width;

    if (isCoarsePointer && width <= 767) {
      return {
        dprCap: 1.35,
        defaultGap: 46,
        waveWidth: 160,
        enableMasking: false
      };
    }

    if (isCoarsePointer && width <= 1366) {
      return {
        dprCap: 1.6,
        defaultGap: 44,
        waveWidth: 170,
        enableMasking: true
      };
    }

    return {
      dprCap: 2,
      defaultGap: 40,
      waveWidth: 180,
      enableMasking: true
    };
  }

  function getViewportSize() {
    if (window.visualViewport) {
      return {
        width: Math.round(window.visualViewport.width),
        height: Math.round(window.visualViewport.height)
      };
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight
    };
  }

  function scheduleInit() {
    if (resizeRafId) {
      cancelAnimationFrame(resizeRafId);
    }

    resizeRafId = requestAnimationFrame(function() {
      resizeRafId = 0;
      init();
    });
  }

  function drawCircle(context, size) {
    context.beginPath();
    context.arc(0, 0, size, 0, Math.PI * 2);
    context.fill();
  }

  function drawPill(context, size) {
    var width = size * 0.48;
    var height = size;
    context.beginPath();
    context.roundRect(-width, -height, width * 2, height * 2, width);
    context.fill();
  }

  function drawStar(context, size, points, innerRatio) {
    context.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var angle = (i * Math.PI) / points - Math.PI / 2;
      var radius = i % 2 === 0 ? size : size * innerRatio;
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.fill();
  }

  function drawShape(context, shape) {
    switch (shape.type) {
      case 'circle':
        return drawCircle(context, shape.size / 1.5);
      case 'pill':
        return drawPill(context, shape.size / 1.4);
      case 'star':
        return drawStar(context, shape.size, shape.points, shape.innerRatio);
    }
  }

  function resolveFill(context, colorDef, size) {
    if (colorDef.type === 'solid') return colorDef.value;
    var gradient = context.createRadialGradient(0, -size * 0.3, 0, 0, size * 0.3, size * 1.5);
    gradient.addColorStop(0, colorDef.stops[0]);
    gradient.addColorStop(1, colorDef.stops[1]);
    return gradient;
  }

  function randomStarProps() {
    return {
      points: rndInt(4, 10),
      innerRatio: rnd(0.1, 0.5)
    };
  }

  function buildGrid() {
    var viewport = getViewportSize();
    var width = viewport.width;
    var height = viewport.height;
    var cols = Math.floor(width / settings.gap);
    var rows = Math.floor(height / settings.gap);
    var offsetX = (width - (cols - 1) * settings.gap) / 2;
    var offsetY = (height - (rows - 1) * settings.gap) / 2;
    var shapes = [];

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var type = pick(SHAPE_TYPES);
        var shape = {
          x: offsetX + col * settings.gap,
          y: offsetY + row * settings.gap,
          type: type,
          color: pick(PALETTE),
          angle: rnd(0, Math.PI * 2),
          size: settings.gap * 0.38,
          scale: settings.restScale,
          maxScale: rnd(settings.minHoverScale, settings.maxHoverScale),
          hovered: false
        };

        if (type === 'star') {
          Object.assign(shape, randomStarProps());
        }

        shapes.push(shape);
      }
    }

    return { shapes: shapes, width: width, height: height };
  }

  function init() {
    var viewport = getViewportSize();
    var width = viewport.width;
    var height = viewport.height;
    var profile = getQualityProfile(viewport);
    var dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);

    settings.waveWidth = profile.waveWidth;
    if (!hasUserDensityOverride) {
      settings.gap = profile.defaultGap;
    }

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    grid = buildGrid();
    frameCount = 0;
    maskRects = [];
  }

  function refreshControlLabels() {
    if (densityValue) {
      densityValue.value = settings.gap + ' px';
      densityValue.textContent = settings.gap + ' px';
    }

    if (speedValue) {
      speedValue.value = settings.waveSpeed + ' /s';
      speedValue.textContent = settings.waveSpeed + ' /s';
    }
  }

  function tick() {
    if (!grid) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    var shapes = grid.shapes;
    var width = grid.width;
    var height = grid.height;
    var profile = getQualityProfile({ width: width, height: height });
    var maskingEnabled = profile.enableMasking;
    var radius = Math.min(width, height) * (settings.radiusVmin / 100);
    var now = performance.now();

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    activity *= 0.93;

    frameCount += 1;
    if (maskingEnabled && frameCount % 10 === 0) {
      maskRects = Array.from(document.querySelectorAll('[data-shape-mask]')).map(function(el) {
        return el.getBoundingClientRect();
      });
    } else if (!maskingEnabled && maskRects.length) {
      maskRects = [];
    }

    var maxDist = Math.sqrt(width * width + height * height);
    waves = waves.filter(function(wave) {
      return (now - wave.startTime) / 1000 * settings.waveSpeed < maxDist + settings.waveWidth;
    });

    for (var i = 0; i < shapes.length; i++) {
      var shape = shapes[i];
      var pad = settings.gap / 2;
      var masked = maskingEnabled && !maskOverride && maskRects.some(function(rect) {
        return shape.x >= rect.left - pad && shape.x <= rect.right + pad &&
               shape.y >= rect.top - pad && shape.y <= rect.bottom + pad;
      });

      if (masked) {
        shape.scale += (0 - shape.scale) * durationToFactor(settings.speedOut);
        if (shape.scale < 0.005) {
          shape.scale = 0;
        }
        continue;
      }

      var pointerInfluence = 0;
      if (pointer && activity > 0.001) {
        var dx = shape.x - pointer.x;
        var dy = shape.y - pointer.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        pointerInfluence = smoothstep(1 - dist / radius) * activity;

        if (pointerInfluence > 0.05 && !shape.hovered) {
          shape.hovered = true;
          shape.maxScale = rnd(settings.minHoverScale, settings.maxHoverScale);
          shape.angle = rnd(0, Math.PI * 2);
          if (shape.type === 'star') {
            Object.assign(shape, randomStarProps());
          }
        } else if (pointerInfluence <= 0.05) {
          shape.hovered = false;
        }
      } else {
        shape.hovered = false;
      }

      var waveInfluence = 0;
      for (var j = 0; j < waves.length; j++) {
        var wave = waves[j];
        var waveRadius = (now - wave.startTime) / 1000 * settings.waveSpeed;
        var wdx = shape.x - wave.x;
        var wdy = shape.y - wave.y;
        var wdist = Math.sqrt(wdx * wdx + wdy * wdy);
        var t = 1 - Math.abs(wdist - waveRadius) / settings.waveWidth;
        if (t > 0) {
          waveInfluence = Math.max(waveInfluence, Math.sin(Math.PI * t));
        }
      }

      var pointerTarget = settings.restScale + pointerInfluence * (shape.maxScale - settings.restScale);
      var waveTarget = settings.restScale + waveInfluence * (shape.maxScale - settings.restScale);
      var target = Math.max(pointerTarget, waveTarget);

      var factor = target > shape.scale ? durationToFactor(settings.speedIn) : durationToFactor(settings.speedOut);
      shape.scale += (target - shape.scale) * factor;

      if (shape.scale < settings.restScale * 0.15) {
        continue;
      }

      ctx.save();
      ctx.translate(shape.x, shape.y);
      ctx.rotate(shape.angle);
      ctx.scale(shape.scale, shape.scale);
      ctx.fillStyle = resolveFill(ctx, shape.color, shape.size);
      drawShape(ctx, shape);
      ctx.restore();
    }

    rafId = requestAnimationFrame(tick);
  }

  function onMove(event) {
    pointer = { x: event.clientX, y: event.clientY };
    activity = 1;
  }

  function triggerWave(x, y) {
    var viewport = getViewportSize();
    var resolvedX = x !== undefined ? x : viewport.width / 2;
    var resolvedY = y !== undefined ? y : viewport.height / 2;

    waves.push({ x: resolvedX, y: resolvedY, startTime: performance.now() });
    maskOverride = true;

    if (maskTimeoutId) {
      window.clearTimeout(maskTimeoutId);
    }

    var delay = Math.sqrt(viewport.width * viewport.width + viewport.height * viewport.height) / settings.waveSpeed;
    maskTimeoutId = window.setTimeout(function() {
      maskOverride = false;
      maskTimeoutId = 0;
    }, delay * 1000);
  }

  function onClick(event) {
    triggerWave(event.clientX, event.clientY);
  }

  function onDensityInput(event) {
    hasUserDensityOverride = true;
    settings.gap = Number(event.target.value);
    refreshControlLabels();
    init();
  }

  function onSpeedInput(event) {
    settings.waveSpeed = Number(event.target.value);
    refreshControlLabels();
  }

  function onPageHide() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (resizeRafId) {
      cancelAnimationFrame(resizeRafId);
    }
    if (maskTimeoutId) {
      window.clearTimeout(maskTimeoutId);
    }
    window.removeEventListener('resize', scheduleInit);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', scheduleInit);
      window.visualViewport.removeEventListener('scroll', scheduleInit);
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('click', onClick);
    window.removeEventListener('pagehide', onPageHide);
  }

  refreshControlLabels();
  init();
  rafId = requestAnimationFrame(tick);

  window.addEventListener('resize', scheduleInit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleInit);
    window.visualViewport.addEventListener('scroll', scheduleInit);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('click', onClick);
  window.addEventListener('pagehide', onPageHide);

  if (densityInput) {
    densityInput.value = String(settings.gap);
    densityInput.addEventListener('input', onDensityInput);
  }

  if (speedInput) {
    speedInput.value = String(settings.waveSpeed);
    speedInput.addEventListener('input', onSpeedInput);
  }

  if (triggerCenterButton) {
    triggerCenterButton.addEventListener('click', function(event) {
      event.stopPropagation();
      var viewport = getViewportSize();
      triggerWave(viewport.width / 2, viewport.height / 2);
    });
  }

  if (triggerRandomButton) {
    triggerRandomButton.addEventListener('click', function(event) {
      event.stopPropagation();
      var viewport = getViewportSize();
      triggerWave(rnd(0, viewport.width), rnd(0, viewport.height));
    });
  }

  triggerWave();
})();