(function initVisualExperiment() {
      const root = document.querySelector('.visual-core');
      const corePanel = document.querySelector('.core-panel');
      const parallaxLayers = root ? Array.from(root.querySelectorAll('.floating-badge')) : [];
      const particleLayer = document.querySelector('.visual-code-particles');
      const scrollButton = document.querySelector('.visual-scroll');
      const scrollTarget = document.getElementById('experiment-overview');
      const sections = document.querySelectorAll('.visual-section:not(.is-visible)');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const badgeFloatSpeed = (Math.PI * 2) / 3000;
      const badgeMotionPresets = new Map([
        ['badge-1', { depth: 18, ampX: 10, ampY: 24, rotate: 1.6, phase: 0 }],
        ['badge-2', { depth: 24, ampX: 8, ampY: 20, rotate: -1.2, phase: (Math.PI * 2) / 3 }],
        ['badge-3', { depth: 14, ampX: 12, ampY: 26, rotate: 1.9, phase: (Math.PI * 4) / 3 }]
      ]);

      let badgeFrameId = 0;
      let badgeMotion = [];

      const initializeParticles = () => {
        if (!particleLayer) {
          return;
        }

        if (reduceMotion) {
          particleLayer.replaceChildren();
          return;
        }

        const symbols = ['{', '}', '<', '>', '[', ']', '(', ')', '/', '*', '=', '+', ';', '&'];
        const count = window.matchMedia('(max-width: 720px)').matches ? 10 : 16;
        const fragment = document.createDocumentFragment();

        for (let index = 0; index < count; index += 1) {
          const particle = document.createElement('span');
          particle.className = 'visual-particle';
          particle.textContent = symbols[Math.floor(Math.random() * symbols.length)];
          particle.style.left = `${Math.random() * 100}%`;
          particle.style.fontSize = `${12 + Math.random() * 14}px`;
          particle.style.animationDelay = `${Math.random() * -18}s`;
          particle.style.animationDuration = `${12 + Math.random() * 10}s`;
          particle.style.setProperty('--particle-opacity', `${(0.1 + Math.random() * 0.18).toFixed(2)}`);
          particle.style.setProperty('--particle-drift', `${(Math.random() * 64 - 32).toFixed(1)}px`);
          particle.style.setProperty('--particle-depth', `${(Math.random() * 30 - 15).toFixed(1)}px`);
          fragment.appendChild(particle);
        }

        particleLayer.replaceChildren(fragment);
      };

      initializeParticles();

      if (parallaxLayers.length) {
        const motionScale = reduceMotion ? 0.65 : 1;
        badgeMotion = parallaxLayers.map((layer, index) => {
          const orbit = layer.querySelector('.floating-badge-orbit');
          const presetEntry = Array.from(badgeMotionPresets.entries()).find(([className]) => layer.classList.contains(className));
          const preset = presetEntry ? presetEntry[1] : {
            depth: 16,
            ampX: 9,
            ampY: 20,
            rotate: 1.4,
            phase: index * 1.3
          };

          return {
            orbit,
            depth: preset.depth,
            ampX: preset.ampX * motionScale,
            ampY: preset.ampY * motionScale,
            rotate: preset.rotate * motionScale,
            phase: preset.phase
          };
        }).filter((entry) => entry.orbit);

        const coreMotion = corePanel ? {
          yAmplitude: (reduceMotion ? 1.2 : 2.8),
          xAmplitude: (reduceMotion ? 0.5 : 1.4),
          rotateAmplitude: (reduceMotion ? 0.12 : 0.28),
          scaleAmplitude: (reduceMotion ? 0.002 : 0.005),
          phase: 0.65
        } : null;

        const animateBadges = (timestamp) => {
          const motionTime = timestamp * badgeFloatSpeed * (reduceMotion ? 0.72 : 1);

          badgeMotion.forEach(({ orbit, ampX, ampY, rotate, phase }) => {
            const driftX = Math.sin(motionTime * 0.55 + phase) * ampX;
            const driftY = Math.sin(motionTime + phase) * ampY * -1;
            const tilt = Math.sin(motionTime * 0.7 + phase) * rotate;

            orbit.style.transform = `translate3d(${driftX.toFixed(2)}px, ${driftY.toFixed(2)}px, 0) rotate(${tilt.toFixed(2)}deg)`;
          });

          if (coreMotion && corePanel) {
            const panelX = Math.sin(motionTime * 0.35 + coreMotion.phase) * coreMotion.xAmplitude;
            const panelY = Math.sin(motionTime * 0.5 + coreMotion.phase) * coreMotion.yAmplitude * -1;
            const panelRotate = Math.sin(motionTime * 0.28 + coreMotion.phase) * coreMotion.rotateAmplitude;
            const panelScale = 1 + Math.sin(motionTime * 0.42 + coreMotion.phase) * coreMotion.scaleAmplitude;

            corePanel.style.transform = `translate3d(${panelX.toFixed(2)}px, ${panelY.toFixed(2)}px, 0) rotate(${panelRotate.toFixed(2)}deg) scale(${panelScale.toFixed(4)})`;
          }

          badgeFrameId = window.requestAnimationFrame(animateBadges);
        };

        badgeFrameId = window.requestAnimationFrame(animateBadges);

        window.addEventListener('pagehide', () => {
          if (badgeFrameId) {
            window.cancelAnimationFrame(badgeFrameId);
          }
        }, { once: true });
      }

      if (scrollButton) {
        scrollButton.addEventListener('click', () => {
          if (scrollTarget) {
            scrollTarget.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
          }
        });
      }

      if (root && !reduceMotion) {
        const updateParallax = (event) => {
          const rect = root.getBoundingClientRect();
          const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
          const offsetY = (event.clientY - rect.top) / rect.height - 0.5;

          root.style.transform = `rotateX(${-offsetY * 8}deg) rotateY(${offsetX * 10}deg)`;

          badgeMotion.forEach(({ depth }, index) => {
            const layer = parallaxLayers[index];
            layer.style.setProperty('--badge-shift-x', `${(offsetX * depth).toFixed(2)}px`);
            layer.style.setProperty('--badge-shift-y', `${(offsetY * depth * -0.8).toFixed(2)}px`);
          });
        };

        const resetParallax = () => {
          root.style.transform = 'rotateX(0deg) rotateY(0deg)';

          parallaxLayers.forEach((layer) => {
            layer.style.setProperty('--badge-shift-x', '0px');
            layer.style.setProperty('--badge-shift-y', '0px');
          });
        };

        root.addEventListener('pointermove', updateParallax);
        root.addEventListener('pointerleave', resetParallax);
      }

      if (!sections.length) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.18,
          rootMargin: '0px 0px -8% 0px'
        }
      );

      sections.forEach((section) => {
        observer.observe(section);
      });
    })();