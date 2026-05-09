(function () {
  const documentRoot = document.documentElement;
  const isIpadLikeDevice =
    /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  if (isIpadLikeDevice) {
    documentRoot.classList.add('is-ipad');
  }

  const brandFontReady = (() => {
    const markReady = () => {
      documentRoot.classList.remove('fonts-pending');
      documentRoot.classList.add('fonts-ready');
    };

    if (!document.fonts || typeof document.fonts.load !== 'function') {
      markReady();
      return Promise.resolve();
    }

    const requestedFonts = Promise.allSettled([
      document.fonts.load('700 1em "Space Grotesk"'),
      document.fonts.load('600 1em "Space Grotesk"')
    ]);
    const readyFonts = Promise.allSettled([document.fonts.ready, requestedFonts]);
    const timeout = new Promise((resolve) => {
      window.setTimeout(resolve, 2500);
    });

    return Promise.race([readyFonts, timeout]).finally(markReady);
  })();

  (function initChatSymbol() {
    const wrap = document.querySelector('.chat-page-mark');
    const canvas = wrap ? wrap.querySelector('.hero-mark-canvas') : null;
    const interactionRegion = wrap;
    const THREE_FALLBACK_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';

    if (!wrap || !canvas || !interactionRegion) {
      return;
    }

    wrap.classList.add('webgl-pending');

    function markNoWebgl() {
      wrap.classList.add('no-webgl');
      wrap.classList.remove('webgl-pending');
    }

    function loadThreeFallback() {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = THREE_FALLBACK_CDN;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    function boot() {
      if (typeof THREE === 'undefined') {
        markNoWebgl();
        return;
      }

      const isDesktopViewport = window.matchMedia('(min-width: 900px)').matches;
      const useDesktopSubtle = isDesktopViewport && !isIpadLikeDevice;

      const EFFECT_RADIUS = useDesktopSubtle ? 3.0 : 4.6;
      const EFFECT_DEPTH = useDesktopSubtle ? 0.68 : 1.9;
      const SHADOW_ALPHA = 0.07;
      const SHADOW_BLUR = 72;
      const SHADOW_OPACITY = 0.34;
      const EFFECT_LERP = useDesktopSubtle ? 0.12 : 0.22;
      const PROXIMITY_PADDING = useDesktopSubtle ? 18 : 0;
      const BASE_ROTATION = 0;
      const heroMarkColor =
        getComputedStyle(document.documentElement).getPropertyValue('--glass-gray-text').trim() || '#737b85';
      const heroMarkAlpha = 0.5;

      let renderer;

      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance'
        });
      } catch (_error) {
        markNoWebgl();
        return;
      }

      const scene = new THREE.Scene();
      let aspect = 1;
      const cameraDistance = 5.35;
      const camera = new THREE.OrthographicCamera(
        -cameraDistance * aspect,
        cameraDistance * aspect,
        cameraDistance,
        -cameraDistance,
        0.01,
        100
      );
      camera.position.set(0, -4, 7);
      camera.lookAt(0, 0, 0);

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2(2, 2);

      const displacement = new THREE.Vector3(999, 999, 0);
      const displacementTarget = new THREE.Vector3(999, 999, 0);

      function buildTexture({ shadow }) {
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = 1024;
        textureCanvas.height = 1024;

        const ctx = textureCanvas.getContext('2d');
        if (!ctx) {
          return null;
        }

        ctx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const markX = textureCanvas.width * 0.5;
        const markY = textureCanvas.height * 0.32;
        const markFont = '700 560px "Space Grotesk", sans-serif';

        if (shadow) {
          ctx.fillStyle = `rgba(0, 0, 0, ${SHADOW_ALPHA})`;
          ctx.filter = `blur(${SHADOW_BLUR}px)`;
          ctx.font = markFont;
          ctx.fillText('/>', markX, markY + 14);
          ctx.filter = 'none';
        } else {
          ctx.fillStyle = heroMarkColor;
          ctx.globalAlpha = heroMarkAlpha;
          ctx.font = markFont;
          ctx.fillText('/>', markX, markY);
          ctx.globalAlpha = 1;
        }

        const texture = new THREE.CanvasTexture(textureCanvas);
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        return texture;
      }

      const textTexture = buildTexture({ shadow: false });
      const shadowTexture = buildTexture({ shadow: true });

      if (!textTexture || !shadowTexture) {
        renderer.dispose();
        markNoWebgl();
        return;
      }

      const geometry = new THREE.PlaneGeometry(16.8, 16.8, 180, 180);

      const shadowMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTexture: { value: shadowTexture },
          uDisplacement: { value: displacement },
          uRadius: { value: EFFECT_RADIUS },
          uOpacity: { value: SHADOW_OPACITY }
        },
        vertexShader: `
      varying vec2 vUv;
      varying float vDist;
      uniform vec3 uDisplacement;

      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vDist = length(uDisplacement - worldPosition.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
        fragmentShader: `
      varying vec2 vUv;
      varying float vDist;
      uniform sampler2D uTexture;
      uniform float uRadius;
      uniform float uOpacity;

      void main() {
        vec4 color = texture2D(uTexture, vUv);
        if (color.a < 0.02) {
          discard;
        }

        if (vDist < uRadius) {
          float fade = smoothstep(0.0, uRadius * 1.2, vDist);
          color.a *= fade;
        }
        color.a *= uOpacity;
        gl_FragColor = color;
      }
    `,
        transparent: true,
        depthWrite: false
      });

      const symbolMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTexture: { value: textTexture },
          uDisplacement: { value: displacement },
          uRadius: { value: EFFECT_RADIUS },
          uDepth: { value: EFFECT_DEPTH }
        },
        vertexShader: `
      varying vec2 vUv;
      uniform vec3 uDisplacement;
      uniform float uRadius;
      uniform float uDepth;

      float easeInOutCubic(float x) {
        return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
      }

      float mapValue(float value, float min1, float max1, float min2, float max2) {
        return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
      }

      void main() {
        vUv = uv;
        vec3 newPosition = position;

        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        float dist = length(uDisplacement - worldPosition.xyz);

        if (dist < uRadius) {
          float mapped = mapValue(dist, 0.0, uRadius, 1.0, 0.0);
          float influence = easeInOutCubic(mapped) * uDepth;
          newPosition.z += influence;
        }

        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
      }
    `,
        fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uTexture;

      void main() {
        vec4 color = texture2D(uTexture, vUv);
        if (color.a < 0.02) {
          discard;
        }

        gl_FragColor = color;
      }
    `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      const shadowPlane = new THREE.Mesh(geometry, shadowMaterial);
      shadowPlane.position.set(0, -0.22, -0.22);
      shadowPlane.rotation.z = BASE_ROTATION;
      scene.add(shadowPlane);

      const symbolPlane = new THREE.Mesh(geometry, symbolMaterial);
      symbolPlane.rotation.z = BASE_ROTATION;
      scene.add(symbolPlane);

      const hitPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
      );
      scene.add(hitPlane);

      function updatePointer(event) {
        const rect = wrap.getBoundingClientRect();
        const left = rect.left - PROXIMITY_PADDING;
        const top = rect.top - PROXIMITY_PADDING;
        const width = rect.width + PROXIMITY_PADDING * 2;
        const height = rect.height + PROXIMITY_PADDING * 2;

        const isNear =
          event.clientX >= left &&
          event.clientX <= left + width &&
          event.clientY >= top &&
          event.clientY <= top + height;

        if (!isNear) {
          resetPointer();
          return;
        }

        const x = (event.clientX - left) / width;
        const y = (event.clientY - top) / height;

        pointer.x = x * 2 - 1;
        pointer.y = -(y * 2 - 1);

        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObject(hitPlane);

        if (intersects.length > 0) {
          const point = intersects[0].point;
          displacementTarget.set(point.x, point.y, point.z);
        }
      }

      function resetPointer() {
        displacementTarget.set(999, 999, 0);
      }

      function onPointerDown(event) {
        if (event.pointerId !== undefined && interactionRegion.setPointerCapture) {
          try {
            interactionRegion.setPointerCapture(event.pointerId);
          } catch (_err) {
            // Ignore pointer capture failures on unsupported browsers.
          }
        }
        updatePointer(event);
      }

      function onPointerUp(event) {
        if (event.pointerId !== undefined && interactionRegion.releasePointerCapture) {
          try {
            interactionRegion.releasePointerCapture(event.pointerId);
          } catch (_err) {
            // Ignore pointer capture failures on unsupported browsers.
          }
        }
        resetPointer();
      }

      function resize() {
        const rect = wrap.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, useDesktopSubtle ? 1 : 1.75));
        renderer.setSize(width, height, false);

        aspect = width / height;
        camera.left = -cameraDistance * aspect;
        camera.right = cameraDistance * aspect;
        camera.top = cameraDistance;
        camera.bottom = -cameraDistance;
        camera.updateProjectionMatrix();
      }

      let animFrameId = null;
      let isAnimating = false;

      function animate() {
        if (!isAnimating) return;
        displacement.lerp(displacementTarget, EFFECT_LERP);
        renderer.render(scene, camera);
        animFrameId = requestAnimationFrame(animate);
      }

      function startAnimation() {
        if (isAnimating) return;
        isAnimating = true;
        animFrameId = requestAnimationFrame(animate);
      }

      function stopAnimation() {
        isAnimating = false;
        if (animFrameId !== null) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopAnimation();
        } else {
          startAnimation();
        }
      });

      let resizeTicking = false;

      function onResize() {
        if (resizeTicking) return;
        resizeTicking = true;
        requestAnimationFrame(() => {
          resize();
          resizeTicking = false;
        });
      }

      interactionRegion.addEventListener('pointerenter', updatePointer);
      interactionRegion.addEventListener('pointerdown', onPointerDown);
      interactionRegion.addEventListener('pointermove', updatePointer);
      interactionRegion.addEventListener('pointerup', onPointerUp);
      interactionRegion.addEventListener('pointercancel', onPointerUp);
      interactionRegion.addEventListener('pointerleave', resetPointer);
      window.addEventListener('resize', onResize);

      resize();
      startAnimation();
      wrap.classList.remove('webgl-pending');
      wrap.classList.add('is-ready');
    }

    brandFontReady.then(() => {
      if (typeof THREE === 'undefined') {
        loadThreeFallback()
          .then(boot)
          .catch(markNoWebgl);
        return;
      }

      boot();
    });
  })();
})();
