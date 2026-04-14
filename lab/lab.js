if (!document.body.classList.contains('page-id-42')) {
  // Run this script only on the lab page scope.
} else {
  const PAGE_SCOPE = 'body.page-id-42';
  const langToggle = document.querySelector(`${PAGE_SCOPE} .lang-toggle`);

  const safeStorage = {
    get(key) {
      try { return localStorage.getItem(key); } catch (_e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (_e) {}
    }
  };

  const translations = {
    en: {
      meta: {
        title: 'UX Lab | Noustelos Studio Santorini',
        description: 'UX Lab by Noustelos Studio presents experimental web concepts, interaction studies and prototype interfaces focused on motion, storytelling and accessibility.'
      },
      lang: {
        switchAria: 'Switch language'
      },
      lab: {
        eyebrow: 'Early Access',
        title: 'UX <em>Lab</em>',
        intro: 'Welcome to the digital research station. Here you will find experimental concepts, interaction studies and ideas still in exploration mode.',
        gridAria: 'Experimental projects',
        card1: {
          title: 'Visual Storytelling Trials',
          desc: 'Experimental layouts focused on sequencing, rhythm and immersive sections.',
          link: 'Open Study'
        },
        card2: {
          title: 'Widget Interaction Patterns',
          desc: 'Micro-UX research for daily inspiration widgets with motion and glass UI.',
          link: 'Open Prototype'
        },
        card3: {
          title: 'Coming Next',
          desc: 'New experimental work is coming soon, with focus on conversion-first UX.',
          link: 'Suggest an Experiment'
        },
        backPrefix: 'Back to'
      }
    },
    gr: {
      meta: {
        title: 'UX Lab | Noustelos Studio Santorini',
        description: 'Το UX Lab του Noustelos Studio παρουσιάζει πειραματικά web concepts, interaction studies και πρωτότυπα interfaces με έμφαση σε motion, storytelling και accessibility.'
      },
      lang: {
        switchAria: 'Αλλαγή γλώσσας'
      },
      lab: {
        eyebrow: 'Early Access',
        title: 'UX <em>Lab</em>',
        intro: 'Καλωσήρθες στο κρυφό εργαστήριο. Εδώ θα βρεις experimental concepts, interaction studies και ιδέες που βρίσκονται ακόμα σε φάση εξερεύνησης.',
        gridAria: 'Πειραματικά projects',
        card1: {
          title: 'Visual Storytelling Trials',
          desc: 'Πειραματικά layouts με έμφαση σε sequencing, rhythm και immersive sections.',
          link: 'Άνοιγμα Study'
        },
        card2: {
          title: 'Widget Interaction Patterns',
          desc: 'Micro-UX έρευνα για daily inspiration widgets με motion και glass UI.',
          link: 'Άνοιγμα Prototype'
        },
        card3: {
          title: 'Coming Next',
          desc: 'Νέα experimental δουλειά έρχεται σύντομα, με focus σε conversion-first UX.',
          link: 'Πρότεινε Experiment'
        },
        backPrefix: 'Επιστροφή στο'
      }
    }
  };

  const getNestedValue = (obj, path) => {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
  };

  const applyLanguage = (lang) => {
    const safeLang = translations[lang] ? lang : 'en';
    const langContent = translations[safeLang];

    document.documentElement.lang = safeLang === 'gr' ? 'el' : 'en';

    document.querySelectorAll(`${PAGE_SCOPE} [data-i18n]`).forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const value = getNestedValue(langContent, key);

      if (typeof value === 'string') {
        const emMatch = value.match(/^(.*?)<em>(.*?)<\/em>(.*?)$/);
        if (emMatch) {
          element.textContent = '';
          if (emMatch[1]) element.appendChild(document.createTextNode(emMatch[1]));
          const em = document.createElement('em');
          em.textContent = emMatch[2];
          element.appendChild(em);
          if (emMatch[3]) element.appendChild(document.createTextNode(emMatch[3]));
        } else {
          element.textContent = value;
        }
      }
    });

    document.querySelectorAll(`${PAGE_SCOPE} [data-i18n-attr]`).forEach((element) => {
      const mappings = element
        .getAttribute('data-i18n-attr')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean);

      mappings.forEach((mapping) => {
        const [attrName, key] = mapping.split(':').map((part) => part.trim());
        const value = getNestedValue(langContent, key);

        if (attrName && typeof value === 'string') {
          element.setAttribute(attrName, value);
        }
      });
    });

    if (langToggle) {
      langToggle.querySelectorAll('[data-lang-option]').forEach((option) => {
        const optionLang = option.getAttribute('data-lang-option');
        option.classList.toggle('is-active', optionLang === safeLang);
      });
    }

    safeStorage.set('siteLanguage', safeLang);
  };

  const preferredLanguage = (() => {
    const storedLang = safeStorage.get('siteLanguage');

    if (storedLang === 'en' || storedLang === 'gr') {
      return storedLang;
    }

    return 'en';
  })();

  applyLanguage(preferredLanguage);

  if (langToggle) {
    langToggle.addEventListener('click', () => {
      const currentLang = safeStorage.get('siteLanguage') || preferredLanguage;
      const nextLang = currentLang === 'en' ? 'gr' : 'en';
      applyLanguage(nextLang);
    });
  }

  let gravitySimulationInitialized = false;

  const initGravitySimulation = () => {
    if (gravitySimulationInitialized) {
      return;
    }

    if (!window.Matter) {
      return;
    }

    const container = document.querySelector(`${PAGE_SCOPE} .lab-physics`);
    const slider = document.querySelector(`${PAGE_SCOPE} #gravitySlider`);
    const label = document.querySelector(`${PAGE_SCOPE} .gravity-label`);
    const icon = document.querySelector(`${PAGE_SCOPE} .planet-icon`);
    const clearButton = document.querySelector(`${PAGE_SCOPE} .gravity-clear`);

    if (!container || !slider || !label || !icon || !clearButton) {
      return;
    }

    const measuredWidth = Math.max(320, Math.floor(container.clientWidth));
    const measuredHeight = Math.floor(container.clientHeight) || 420;

    const { Engine, Render, Runner, Bodies, Composite, Body, Events } = Matter;
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

    slider.addEventListener('input', updatePlanet);
    updatePlanet();

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

    clearButton.addEventListener('click', clearSimulation);

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

    gravitySimulationInitialized = true;
  };

  const drawerTriggers = document.querySelectorAll(`${PAGE_SCOPE} .lab-drawer-trigger`);

  const setDrawerState = (trigger, nextState) => {
    const drawer = trigger.closest('.lab-drawer');
    const contentId = trigger.getAttribute('aria-controls');
    const content = contentId ? document.getElementById(contentId) : null;

    trigger.setAttribute('aria-expanded', String(nextState));

    if (drawer) {
      drawer.classList.toggle('is-open', nextState);
    }

    if (!content) {
      return;
    }

    if (nextState) {
      content.hidden = false;
      content.style.maxHeight = '0px';

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const targetHeight = content.scrollHeight;
          content.style.maxHeight = `${targetHeight}px`;
        });
      });
    } else {
      const currentHeight = content.scrollHeight;
      content.style.maxHeight = `${currentHeight}px`;

      window.requestAnimationFrame(() => {
        content.style.maxHeight = '0px';
      });
    }

    let finalized = false;

    const finalizeState = () => {
      if (finalized) {
        return;
      }

      finalized = true;

      if (nextState) {
        content.style.maxHeight = 'none';
      } else {
        content.hidden = true;
      }
    };

    const onTransitionEnd = (event) => {
      if (event.propertyName !== 'max-height') {
        return;
      }

      content.removeEventListener('transitionend', onTransitionEnd);
      finalizeState();
    };

    content.addEventListener('transitionend', onTransitionEnd);
    window.setTimeout(finalizeState, 920);
  };

  drawerTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';
      const nextState = !isOpen;

      if (nextState) {
        drawerTriggers.forEach((otherTrigger) => {
          if (otherTrigger !== trigger && otherTrigger.getAttribute('aria-expanded') === 'true') {
            setDrawerState(otherTrigger, false);
          }
        });
      }

      setDrawerState(trigger, nextState);

      if (nextState && trigger.id === 'interaction-lab-title') {
        window.setTimeout(() => {
          initGravitySimulation();
        }, 420);
      }
    });
  });

  document.addEventListener('mousemove', (e) => {
    const nebula = document.querySelector(`${PAGE_SCOPE} .lab-nebula`);
    if (!nebula) return;

    const x = (e.clientX / window.innerWidth - 0.5) * 20;
    const y = (e.clientY / window.innerHeight - 0.5) * 20;

    nebula.style.transform = `translate(${x}px,${y}px) scale(1.05)`;
  });
}
