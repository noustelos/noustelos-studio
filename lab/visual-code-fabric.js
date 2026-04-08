(function initCodeFabric() {
  const container = document.getElementById('container');
  if (!container) {
    return;
  }

  const fullCode = [
    'import { lerp, getPointID } from "utils.js";',
    'console.clear();',
    'const CONFIG = { width: 400, height: 400, gridW: 100, gridH: 40, gravity: .2, damping: .99, iterationsPerFrame: 10 };',
    'function main() { const ctx = c.getContext("2d"); const particles = []; const constraints = []; function runloop(delta) { ctx.clearRect(0,0,w,h); particles.forEach(p=>p.update()); constraints.forEach(c=>c.solve()); drawCode(); } }',
    'class Particle { constructor({x, y, char}) { this.pos = new Vec2(x, y); this.char = char; } }'
  ].join(' ');

  const baseConfig = {
    gravity: 0.16,
    damping: 0.986,
    iterationsPerFrame: 6,
    compressFactor: 0.76,
    stretchFactor: 1.18,
    mouseSize: 5400,
    mouseStrength: 4.8,
    contain: false
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (edge0, edge1, value) => {
    const divisor = edge1 - edge0;
    if (divisor === 0) {
      return 0;
    }
    const t = clamp((value - edge0) / divisor, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const getPointID = (row, col, rowCount) => col * rowCount + row;

  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }

    reset(x = 0, y = 0) {
      this.x = x;
      this.y = y;
      return this;
    }

    clone() {
      return new Vec2(this.x, this.y);
    }

    add(vector) {
      this.x += vector.x;
      this.y += vector.y;
      return this;
    }

    subtract(vector) {
      this.x -= vector.x;
      this.y -= vector.y;
      return this;
    }

    subtractNew(vector) {
      return this.clone().subtract(vector);
    }

    scale(value) {
      this.x *= value;
      this.y *= value;
      return this;
    }

    get lengthSquared() {
      return this.x * this.x + this.y * this.y;
    }

    get angle() {
      return Math.atan2(this.y, this.x);
    }
  }

  class Particle {
    constructor({ x, y, pinned, id, char }) {
      this.pos = new Vec2(x, y);
      this.oldPos = new Vec2(x, y);
      this.acceleration = new Vec2();
      this.pinned = pinned;
      this.id = id;
      this.char = char;
      this.downConstraint = null;
    }

    update(delta, config) {
      if (this.pinned) {
        this.acceleration.reset();
        this.oldPos.reset(this.pos.x, this.pos.y);
        return;
      }

      const velocityX = (this.pos.x - this.oldPos.x) * config.damping;
      const velocityY = (this.pos.y - this.oldPos.y) * config.damping;

      this.oldPos.reset(this.pos.x, this.pos.y);

      this.pos.x += velocityX + this.acceleration.x * delta * delta;
      this.pos.y += velocityY + (config.gravity + this.acceleration.y) * delta * delta;

      this.acceleration.reset();
    }

    applyForce(vector) {
      this.acceleration.add(vector);
    }

    contain(config) {
      if (this.pinned) {
        return;
      }

      const radius = 4;
      if (this.pos.x < radius) {
        this.pos.x = radius;
      } else if (this.pos.x > config.width - radius) {
        this.pos.x = config.width - radius;
      }

      if (this.pos.y < radius) {
        this.pos.y = radius;
      } else if (this.pos.y > config.height - radius) {
        this.pos.y = config.height - radius;
      }
    }
  }

  class Constraint {
    constructor({ p1, p2, length, compressFactor, stretchFactor }) {
      this.p1 = p1;
      this.p2 = p2;
      this.length = length;
      this.minLength = length * compressFactor;
      this.maxLength = length * stretchFactor;
    }

    solve() {
      const dx = this.p2.pos.x - this.p1.pos.x;
      const dy = this.p2.pos.y - this.p1.pos.y;
      const distance = Math.hypot(dx, dy);

      if (distance === 0) {
        return;
      }

      let targetLength = this.length;
      if (distance < this.minLength) {
        targetLength = this.minLength;
      } else if (distance > this.maxLength) {
        targetLength = this.maxLength;
      } else {
        return;
      }

      const difference = targetLength - distance;
      const percent = difference / distance / 2;
      const offsetX = dx * percent;
      const offsetY = dy * percent;

      if (!this.p1.pinned) {
        this.p1.pos.x -= offsetX;
        this.p1.pos.y -= offsetY;
      }

      if (!this.p2.pinned) {
        this.p2.pos.x += offsetX;
        this.p2.pos.y += offsetY;
      }
    }
  }

  class Input {
    constructor({ canvas, particles, config }) {
      this.canvas = canvas;
      this.particles = particles;
      this.config = config;
      this.mousePos = new Vec2();
      this.grabRadius = 18;
      this.grabbedParticle = null;

      this.pointerdown = this.pointerdown.bind(this);
      this.pointerup = this.pointerup.bind(this);
      this.pointermove = this.pointermove.bind(this);
      this.contextmenu = this.contextmenu.bind(this);

      canvas.addEventListener('pointerdown', this.pointerdown);
      canvas.addEventListener('pointermove', this.pointermove);
      window.addEventListener('pointerup', this.pointerup);
      canvas.addEventListener('contextmenu', this.contextmenu);
    }

    getPointerPosition(event) {
      const rect = this.canvas.getBoundingClientRect();
      return new Vec2(
        event.clientX - rect.left - this.config.offsetX,
        event.clientY - rect.top - this.config.offsetY
      );
    }

    pointerdown(event) {
      this.mousePos = this.getPointerPosition(event);
      if (typeof this.canvas.setPointerCapture === 'function') {
        this.canvas.setPointerCapture(event.pointerId);
      }

      for (const particle of this.particles) {
        if (this.mousePos.subtractNew(particle.pos).lengthSquared < this.grabRadius * this.grabRadius) {
          this.grabbedParticle = particle;
          particle.originalPinnedState = particle.pinned;
          particle.pinned = true;
          particle.pos.reset(this.mousePos.x, this.mousePos.y);
          particle.oldPos.reset(this.mousePos.x, this.mousePos.y);
          break;
        }
      }
    }

    pointerup() {
      if (this.grabbedParticle) {
        this.grabbedParticle.pinned = this.grabbedParticle.originalPinnedState;
        this.grabbedParticle = null;
      }
    }

    pointermove(event) {
      this.mousePos = this.getPointerPosition(event);

      if (this.grabbedParticle) {
        this.grabbedParticle.pos.reset(this.mousePos.x, this.mousePos.y);
        this.grabbedParticle.oldPos.reset(this.mousePos.x, this.mousePos.y);
      }

      for (const particle of this.particles) {
        if (particle === this.grabbedParticle) {
          continue;
        }

        const diff = this.mousePos.subtractNew(particle.pos);
        const distanceSquared = diff.lengthSquared;
        if (distanceSquared > this.config.mouseSize) {
          continue;
        }

        const angle = diff.angle - Math.PI;
        const strength = smoothstep(this.config.mouseSize, 0, distanceSquared) * this.config.mouseStrength / 340;
        particle.applyForce(new Vec2(Math.cos(angle) * strength, Math.sin(angle) * strength));
      }
    }

    contextmenu(event) {
      event.preventDefault();
    }

    destroy() {
      this.canvas.removeEventListener('pointerdown', this.pointerdown);
      this.canvas.removeEventListener('pointermove', this.pointermove);
      window.removeEventListener('pointerup', this.pointerup);
      this.canvas.removeEventListener('contextmenu', this.contextmenu);
    }
  }

  let state = {
    rafId: 0,
    input: null,
    config: null,
    canvas: null,
    ctx: null,
    particles: [],
    constraints: [],
    charCanvases: {},
    lastTime: 0,
    resizeRaf: 0
  };

  function createConfig() {
    const rect = container.getBoundingClientRect();
    const width = clamp(rect.width - 64, 260, 760);
    const height = clamp(rect.height - 120, 220, 470);
    const gridW = clamp(Math.round(width / 12), 24, 58);
    const gridH = clamp(Math.round(height / 16), 18, 34);

    return {
      ...baseConfig,
      width,
      height,
      gridW,
      gridH,
      cellWidth: width / (gridW - 1),
      cellHeight: height / (gridH - 1),
      offsetX: (rect.width - width) / 2,
      offsetY: (rect.height - height) / 2 + 26
    };
  }

  function buildCharCanvases(config) {
    const charCanvases = {};
    const fontSize = Math.max(12, config.cellHeight * 1.08);

    for (const character of new Set(fullCode)) {
      if (character === ' ') {
        continue;
      }

      const offscreen = document.createElement('canvas');
      offscreen.width = offscreen.height = Math.ceil(fontSize * 1.55);
      const ctx = offscreen.getContext('2d');
      ctx.font = `700 ${fontSize}px ${getComputedStyle(document.documentElement).getPropertyValue('--fabric-code').trim() || 'monospace'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#30343f';
      ctx.fillText(character, offscreen.width / 2, offscreen.height / 2);
      charCanvases[character] = offscreen;
    }

    return charCanvases;
  }

  function cleanup() {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
    }
    if (state.resizeRaf) {
      window.cancelAnimationFrame(state.resizeRaf);
    }
    if (state.input) {
      state.input.destroy();
    }
    const existingCanvas = container.querySelector('canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }
  }

  function drawCode() {
    const { ctx, config, particles, charCanvases } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);

    particles.forEach((particle) => {
      if (!particle.char || particle.char === ' ') {
        return;
      }

      const image = charCanvases[particle.char];
      if (!image) {
        return;
      }

      let cos = 1;
      let sin = 0;
      if (particle.downConstraint) {
        const dx = particle.downConstraint.p2.pos.x - particle.downConstraint.p1.pos.x;
        const dy = particle.downConstraint.p2.pos.y - particle.downConstraint.p1.pos.y;
        const angle = Math.atan2(dy, dx) - Math.PI / 2;
        cos = Math.cos(angle);
        sin = Math.sin(angle);
      }

      const half = image.width / 2;
      ctx.setTransform(cos, sin, -sin, cos, particle.pos.x + config.offsetX, particle.pos.y + config.offsetY);
      ctx.drawImage(image, -half, -half);
    });
  }

  function stepFrame(timestamp) {
    const { config, particles, constraints } = state;
    const delta = state.lastTime ? clamp((timestamp - state.lastTime) / 16.666, 0.9, 1.8) : 1;
    state.lastTime = timestamp;

    particles.forEach((particle) => particle.update(delta, config));

    for (let iteration = 0; iteration < config.iterationsPerFrame; iteration += 1) {
      for (let index = 0; index < constraints.length; index += 1) {
        constraints[index].solve();
      }
    }

    if (config.contain) {
      particles.forEach((particle) => particle.contain(config));
    }

    drawCode();
    state.rafId = window.requestAnimationFrame(stepFrame);
  }

  function buildScene() {
    cleanup();

    const config = createConfig();
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(container.clientWidth);
    canvas.height = Math.floor(container.clientHeight);
    container.prepend(canvas);

    const ctx = canvas.getContext('2d');
    const particles = [];
    const constraints = [];

    for (let column = 0; column < config.gridW; column += 1) {
      for (let row = 0; row < config.gridH; row += 1) {
        const x = column * config.cellWidth;
        const y = row * config.cellHeight;
        const id = getPointID(row, column, config.gridH);
        const pinned = row === 0;
        const charIndex = (column + row * config.gridW) % fullCode.length;
        const char = fullCode[charIndex] || ' ';

        particles.push(new Particle({ x, y, pinned, id, char }));
      }
    }

    for (let column = 0; column < config.gridW; column += 1) {
      for (let row = 0; row < config.gridH; row += 1) {
        const id = getPointID(row, column, config.gridH);
        const particle = particles[id];

        if (row < config.gridH - 1) {
          const bottomParticle = particles[getPointID(row + 1, column, config.gridH)];
          const verticalConstraint = new Constraint({
            p1: particle,
            p2: bottomParticle,
            length: config.cellHeight,
            compressFactor: config.compressFactor,
            stretchFactor: config.stretchFactor
          });
          particle.downConstraint = verticalConstraint;
          constraints.push(verticalConstraint);
        }

        if (column < config.gridW - 1) {
          const rightParticle = particles[getPointID(row, column + 1, config.gridH)];
          constraints.push(new Constraint({
            p1: particle,
            p2: rightParticle,
            length: config.cellWidth,
            compressFactor: config.compressFactor,
            stretchFactor: config.stretchFactor
          }));
        }
      }
    }

    state = {
      ...state,
      config,
      canvas,
      ctx,
      particles,
      constraints,
      charCanvases: buildCharCanvases(config),
      lastTime: 0,
      input: new Input({ canvas, particles, config })
    };

    state.rafId = window.requestAnimationFrame(stepFrame);
  }

  const handleResize = () => {
    if (state.resizeRaf) {
      window.cancelAnimationFrame(state.resizeRaf);
    }
    state.resizeRaf = window.requestAnimationFrame(buildScene);
  };

  window.addEventListener('resize', handleResize);
  window.addEventListener('pagehide', cleanup, { once: true });

  buildScene();
})();