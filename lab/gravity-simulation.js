if (!document.body.classList.contains('page-id-42-gravity')) {
  // Run only on the gravity simulation page.
} else if (!window.Matter) {
  // Matter.js is required for this page.
} else {
  const { Engine, Render, Runner, Bodies, Composite, Body, Events } = Matter;
  const container = document.querySelector('.page-id-42-gravity .lab-physics');
  const slider = document.querySelector('.page-id-42-gravity #gravitySlider');
  const label = document.querySelector('.page-id-42-gravity .gravity-label');
  const icon = document.querySelector('.page-id-42-gravity .planet-icon');
  const clearButton = document.querySelector('.page-id-42-gravity .gravity-clear');

  if (!container || !slider || !label || !icon || !clearButton) {
    // Missing required elements, skip init.
  } else {
    const measuredWidth = Math.max(320, Math.floor(container.clientWidth));
    const measuredHeight = Math.floor(container.clientHeight) || 420;
    const engine = Engine.create();
    const render = Render.create({
      element: container,
      engine,
      options: {
        width: measuredWidth,
        height: measuredHeight,
        wireframes: false,
        background: '#050505',
        pixelRatio: window.devicePixelRatio || 1
      }
    });

    Render.run(render);

    const runner = Runner.create();
    Runner.run(runner, engine);

    const ground = Bodies.rectangle(
      measuredWidth / 2,
      measuredHeight - 10,
      measuredWidth,
      40,
      { isStatic: true, render: { visible: false } }
    );

    Composite.add(engine.world, [ground]);

    const planets = [
      { name: 'Mercury', g: 3.7, color: '#b4b4b4', mass: 0.4 },
      { name: 'Venus', g: 8.87, color: '#c9a36a', mass: 0.8 },
      { name: 'Earth', g: 9.81, color: '#4aa3ff', mass: 1 },
      { name: 'Moon', g: 1.62, color: '#dfdfdf', mass: 0.2 },
      { name: 'Mars', g: 3.71, color: '#ff6a3d', mass: 0.5 },
      { name: 'Jupiter', g: 24.79, color: '#d9b38c', mass: 2 },
      { name: 'Saturn', g: 10.44, color: '#e6d3a3', mass: 1.2 },
      { name: 'Uranus', g: 8.69, color: '#7fe0ff', mass: 1 },
      { name: 'Neptune', g: 11.15, color: '#3f6fff', mass: 1.3 }
    ];

    let currentPlanet = planets[2];

    const updatePlanet = () => {
      const nextPlanet = planets[Number(slider.value)] || planets[2];
      currentPlanet = nextPlanet;

      engine.gravity.y = currentPlanet.g / 9.81;
      label.textContent = `${currentPlanet.name} - ${currentPlanet.g} m/s²`;
      icon.style.background = currentPlanet.color;
    };

    const clearSimulation = () => {
      const allBodies = Composite.allBodies(engine.world);

      allBodies.forEach((body) => {
        if (!body.isStatic) {
          Composite.remove(engine.world, body);
        }
      });

      slider.value = '2';
      updatePlanet();
    };

    slider.addEventListener('input', updatePlanet);
    clearButton.addEventListener('click', clearSimulation);
    updatePlanet();

    container.addEventListener('click', (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const size = 30 + Math.random() * 40;

      let body;

      if (Math.random() > 0.5) {
        body = Bodies.rectangle(x, y, size, size, {
          restitution: 0.5,
          friction: 0.1,
          render: {
            fillStyle: 'transparent',
            strokeStyle: '#ffffff',
            lineWidth: 1
          }
        });
      } else {
        body = Bodies.circle(x, y, size / 2, {
          restitution: 0.6,
          friction: 0.1,
          render: {
            fillStyle: 'transparent',
            strokeStyle: '#ffffff',
            lineWidth: 1
          }
        });
      }

      Composite.add(engine.world, body);
    });

    Events.on(engine, 'beforeUpdate', () => {
      const bodies = Composite.allBodies(engine.world);

      bodies.forEach((body) => {
        if (body.isStatic) {
          return;
        }

        const dx = measuredWidth / 2 - body.position.x;
        const dy = measuredHeight / 2 - body.position.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
        const force = currentPlanet.mass * 0.00005;

        Body.applyForce(body, body.position, {
          x: (dx / dist) * force,
          y: (dy / dist) * force
        });
      });
    });

    Events.on(engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        let body = null;

        if (pair.bodyA === ground) body = pair.bodyB;
        if (pair.bodyB === ground) body = pair.bodyA;
        if (!body) return;

        const velocity = Math.abs(body.velocity.y);

        if (velocity > 2) {
          body.render.strokeStyle = '#ffffff';
          body.render.lineWidth = 2;

          body.plugin = body.plugin || {};
          body.plugin.glow = true;

          window.setTimeout(() => {
            body.render.lineWidth = 1;
            body.plugin.glow = false;
          }, 200);
        }
      });
    });

    Events.on(render, 'afterRender', () => {
      const ctx = render.context;
      const bodies = Composite.allBodies(engine.world);

      bodies.forEach((body) => {
        if (!body.plugin || !body.plugin.glow) {
          return;
        }

        ctx.save();
        ctx.shadowColor = 'white';
        ctx.shadowBlur = 25;
        ctx.beginPath();

        if (body.circleRadius) {
          ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
        } else {
          const width = body.bounds.max.x - body.bounds.min.x;
          const height = body.bounds.max.y - body.bounds.min.y;
          ctx.rect(body.position.x - width / 2, body.position.y - height / 2, width, height);
        }

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      });
    });
  }
}
