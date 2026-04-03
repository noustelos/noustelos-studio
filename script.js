// Minimal script for mobile navigation toggle and close-on-click behavior.
const navToggle = document.querySelector('.nav-toggle');
const menu = document.querySelector('#site-menu');
const langToggle = document.querySelector('.lang-toggle');
const topLinks = document.querySelectorAll('.logo, .footer-top-link');
const siteHeader = document.querySelector('.site-header');
const sectionNavLinks = document.querySelectorAll('.menu a[href^="#"]');
const documentRoot = document.documentElement;
const currentYear = String(new Date().getFullYear());
const obfuscatedMailLinks = document.querySelectorAll('.js-contact-mail');
const contactForm = document.querySelector('#contact-form');
const cookieBanner = document.querySelector('#cookie-banner');
const cookieAccept = document.querySelector('#cookie-accept');
const cookieDecline = document.querySelector('#cookie-decline');
const isIpadLikeDevice =
  /iPad/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (isIpadLikeDevice) {
  documentRoot.classList.add('is-ipad');
}

const brandFontReady = (() => {
  const finalize = () => {
    documentRoot.classList.remove('fonts-pending');
    documentRoot.classList.add('fonts-ready');
  };

  if (!document.fonts || typeof document.fonts.load !== 'function') {
    finalize();
    return Promise.resolve();
  }

  const fontLoads = Promise.allSettled([
    document.fonts.load('700 1em "Space Grotesk"'),
    document.fonts.load('600 1em "Space Grotesk"')
  ]);
  const fontSettled = Promise.allSettled([document.fonts.ready, fontLoads]);
  const timeout = new Promise((resolve) => {
    window.setTimeout(resolve, 2500);
  });

  return Promise.race([fontSettled, timeout]).finally(finalize);
})();

const translations = {
  en: {
    meta: {
      title: 'Noustelos Studio Santorini | Web Design & Development',
      description: 'Noustelos Studio in Santorini designs fast, SEO-ready websites for tourism brands, hotels and local businesses with clean UX, storytelling and high performance.'
    },
    nav: {
      mainAria: 'Main navigation',
      toggleAria: 'Toggle menu',
      work: 'Work',
      services: 'Services',
      about: 'About',
      contact: 'Contact'
    },
    lang: {
      switchAria: 'Switch language'
    },
    hero: {
      title: 'Modern Websites for Tourism & Creative Projects',
      subtitle: 'Clean design. Fast performance. Clear storytelling.',
      intro: 'Designed and built by Nick Karadimas',
      ctaWork: 'View My Work',
      ctaContact: 'Contact'
    },
    work: {
      title: 'Selected Work',
      viewProject: 'View Project',
      project1: {
        alt: '365orthodoxy project preview',
        desc: 'Landing page for widget promotion.'
      },
      project2: {
        alt: 'Discover Diakopto website preview',
        desc: 'Tourism guide website presenting the region, attractions and experiences.'
      },
      project3: {
        alt: 'Vouraikos Gorge project preview',
          desc: 'Vouraikos Gorge, Unesco Global Geopark.'
      },
      project4: {
        alt: 'Odontotos railway project preview',
        desc: 'Tourism landing page for the Odontotos railway and Vouraikos Gorge. Video hero, immersive storytelling and mobile optimization.'
      },
      project5: {
        alt: 'Honeymoon Beach Studios project preview',
        desc: 'Simple, clean, SEO optimised webpage for a family owned hotel.'
      },
      project6: {
        alt: 'Daily Inspiration Widget project preview',
        desc: 'Daily Bible inspiration and feast-day reminders. Minimalist design, glass-style visuals, and smooth, intuitive UX.'
      }
    },
    services: {
      title: 'Services',
      card1: {
        title: 'Website Design',
        desc: 'Modern responsive websites for tourism businesses and local companies.'
      },
      card2: {
        title: 'Landing Pages',
        desc: 'High-conversion landing pages for products, campaigns and events.'
      },
      card3: {
        title: 'Creative Web Projects',
        desc: 'Visual storytelling and experimental interactive web experiences.'
      }
    },
    about: {
      title: 'About',
      p1: "I'm Nick Karadimas, a creative web designer and developer based in Santorini.",
      p2: 'I build modern websites that focus on clarity, performance, and visual storytelling, combining clean design with practical functionality so businesses can present themselves clearly online.',
      p3: 'I also leverage cutting-edge tools and AI-assisted workflows to streamline creative processes, help improve efficiency, and deliver high-quality results for clients, while keeping creative judgment and craftsmanship at the center of every project.'
    },
    contact: {
      title: "Let's Work Together",
      text: 'If you need a modern website or landing page, feel free to contact me.',
      email: 'Email',
      directEmail: 'Direct Email',
      form: {
        nameLabel: 'Name',
        messageLabel: 'Project details',
        submit: 'Send via email app',
        note: 'Your email client will open with a prefilled message.'
      }
    },
    footer: {
      labAria: 'Open UX Lab',
      universeAria: 'Open universe page',
      topAria: 'Back to top',
      rights: 'Designed in Santorini | © {{year}} all rights reserved | In collaboration with WebHostPro',
      privacy: 'Privacy Policy',
      privacyHref: '/privacy-policy-en.html'
    },
    cookie: {
      text: 'This site uses essential cookies for language and interface preferences.',
      accept: 'Accept',
      decline: 'Decline'
    }
  },
  gr: {
    meta: {
      title: 'Noustelos Studio Santorini | Web Design & Ανάπτυξη',
      description: 'Το Noustelos Studio στη Σαντορίνη σχεδιάζει γρήγορες, SEO-ready ιστοσελίδες για τουριστικά brands, ξενοδοχεία και τοπικές επιχειρήσεις, με καθαρό UX και δυνατή απόδοση.'
    },
    nav: {
      mainAria: 'Κύρια πλοήγηση',
      toggleAria: 'Εναλλαγή μενού',
      work: 'Portfolio',
      services: 'Υπηρεσίες',
      about: 'Σχετικά',
      contact: 'Επικοινωνία'
    },
    lang: {
      switchAria: 'Αλλαγή γλώσσας'
    },
    hero: {
      title: 'Μοντέρνες Ιστοσελίδες για Τουρισμό & Δημιουργικά Projects',
      subtitle: 'Καθαρός σχεδιασμός. Γρήγορη απόδοση. Σαφές storytelling.',
      intro: 'Σχεδιασμός και ανάπτυξη: Νίκος Καραδήμας',
      ctaWork: 'Δες τη Δουλειά μου',
      ctaContact: 'Επικοινωνία'
    },
    work: {
      title: 'Επιλεγμένα Έργα',
      viewProject: 'Δες το Project',
      project1: {
        alt: 'Προεπισκόπηση project 365orthodoxy',
        desc: 'Landing page για προώθηση widget.'
      },
      project2: {
        alt: 'Προεπισκόπηση ιστοσελίδας Discover Diakopto',
        desc: 'Ιστοσελίδα τουριστικού οδηγού που παρουσιάζει την περιοχή, τα αξιοθέατα και τις εμπειρίες.'
      },
      project3: {
        alt: 'Προεπισκόπηση project Φαράγγι Βουραϊκού',
          desc: 'Φαράγγι Βουραϊκού, Unesco Global Geopark.'
      },
      project4: {
        alt: 'Προεπισκόπηση project Οδοντωτός σιδηρόδρομος',
        desc: 'Τουριστικό landing page για τον Οδοντωτό και το Φαράγγι Βουραϊκού. Video hero, immersive storytelling και mobile optimization.'
      },
      project5: {
        alt: 'Προεπισκόπηση project Honeymoon Beach Studios',
        desc: 'Απλή, καθαρή, SEO optimised ιστοσελίδα για οικογενειακό ξενοδοχείο.'
      },
      project6: {
        alt: 'Προεπισκόπηση project Daily Inspiration Widget',
        desc: 'Καθημερινή βιβλική έμπνευση και υπενθυμίσεις εορτολογίου. Minimalist design, glass-style visuals και ομαλό, διαισθητικό UX.'
      }
    },
    services: {
      title: 'Υπηρεσίες',
      card1: {
        title: 'Σχεδιασμός Ιστοσελίδων',
        desc: 'Μοντέρνες responsive ιστοσελίδες για τουριστικές επιχειρήσεις και τοπικές εταιρείες.'
      },
      card2: {
        title: 'Landing Pages',
        desc: 'Landing pages υψηλής μετατροπής για προϊόντα, καμπάνιες και events.'
      },
      card3: {
        title: 'Δημιουργικά Web Projects',
        desc: 'Οπτική αφήγηση και πειραματικές διαδραστικές web εμπειρίες.'
      }
    },
    about: {
      title: 'Σχετικά',
      p1: 'Είμαι ο Νίκος Καραδήμας, creative web designer και developer με βάση τη Σαντορίνη.',
      p2: 'Δημιουργώ μοντέρνες ιστοσελίδες με έμφαση στη σαφήνεια, την απόδοση και το visual storytelling, συνδυάζοντας καθαρό design με πρακτική λειτουργικότητα ώστε οι επιχειρήσεις να παρουσιάζονται ξεκάθαρα online.',
      p3: 'Αξιοποιώ επίσης σύγχρονα εργαλεία και AI-assisted workflows για να επιταχύνω δημιουργικές διαδικασίες, να αυξάνω την αποτελεσματικότητα και να προσφέρω υψηλής ποιότητας αποτελέσματα, κρατώντας πάντα την ανθρώπινη κρίση και τη δημιουργικότητα στο επίκεντρο.'
    },
    contact: {
      title: 'Ας Συνεργαστούμε',
      text: 'Αν χρειάζεσαι μια μοντέρνα ιστοσελίδα ή landing page, μπορείς να επικοινωνήσεις μαζί μου.',
      email: 'Email',
      directEmail: 'Άμεσο Email',
      form: {
        nameLabel: 'Όνομα',
        messageLabel: 'Λεπτομέρειες έργου',
        submit: 'Αποστολή μέσω εφαρμογής email',
        note: 'Θα ανοίξει η εφαρμογή email με προσυμπληρωμένο μήνυμα.'
      }
    },
    footer: {
      labAria: 'Άνοιγμα UX Lab',
      universeAria: 'Άνοιγμα σελίδας universe',
      topAria: 'Επιστροφή στην κορυφή',
      rights: 'Σχεδιασμένο στη Σαντορίνη | © {{year}} όλα τα δικαιώματα διατηρούνται | Σε συνεργασία με τη WebHostPro',
      privacy: 'Πολιτική Απορρήτου',
      privacyHref: '/privacy-policy.html'
    },
    cookie: {
      text: 'Αυτός ο ιστότοπος χρησιμοποιεί απαραίτητα cookies για γλώσσα και προτιμήσεις περιβάλλοντος.',
      accept: 'Αποδοχή',
      decline: 'Απόρριψη'
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

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    const value = getNestedValue(langContent, key);

    if (typeof value === 'string') {
      element.textContent = value.replace('{{year}}', currentYear);
    }
  });

  document.querySelectorAll('[data-i18n-attr]').forEach((element) => {
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

  localStorage.setItem('siteLanguage', safeLang);
};

const applyDynamicYear = () => {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = currentYear;
  });
};

const setupMailLinks = () => {
  if (!obfuscatedMailLinks.length) {
    return;
  }

  obfuscatedMailLinks.forEach((link) => {
    const user = link.getAttribute('data-mail-user');
    const domain = link.getAttribute('data-mail-domain');

    if (!user || !domain) {
      return;
    }

    const email = `${user}@${domain}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = `mailto:${email}`;
    });
  });
};

const setupContactForm = () => {
  if (!contactForm) {
    return;
  }

  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const botField = (formData.get('website') || '').toString().trim();

    if (botField) {
      return;
    }

    const name = (formData.get('name') || '').toString().trim();
    const message = (formData.get('message') || '').toString().trim();

    if (!name || !message) {
      return;
    }

    const subject = encodeURIComponent(`New website inquiry from ${name}`);
    const body = encodeURIComponent(`Name: ${name}\n\nProject details:\n${message}`);
    window.location.href = `mailto:info@noustelos.gr?subject=${subject}&body=${body}`;
  });
};

const setupCookieConsent = () => {
  if (!cookieBanner || !cookieAccept || !cookieDecline) {
    return;
  }

  const consentKey = 'siteCookieConsent';
  const existingConsent = localStorage.getItem(consentKey);

  if (!existingConsent) {
    cookieBanner.hidden = false;
  }

  const setConsent = (value) => {
    localStorage.setItem(consentKey, value);
    cookieBanner.hidden = true;
  };

  cookieAccept.addEventListener('click', () => setConsent('accepted'));
  cookieDecline.addEventListener('click', () => setConsent('declined'));
};

const preferredLanguage = (() => {
  const storedLang = localStorage.getItem('siteLanguage');

  if (storedLang === 'en' || storedLang === 'gr') {
    return storedLang;
  }

  return 'en';
})();

applyLanguage(preferredLanguage);
applyDynamicYear();
setupMailLinks();
setupContactForm();
setupCookieConsent();

if (navToggle && menu) {
  navToggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menu.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

if (langToggle) {
  langToggle.addEventListener('click', () => {
    const currentLang = localStorage.getItem('siteLanguage') || preferredLanguage;
    const nextLang = currentLang === 'en' ? 'gr' : 'en';
    applyLanguage(nextLang);
  });
}

if (topLinks.length) {
  topLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      history.replaceState(null, '', '#top');
    });
  });
}

if (sectionNavLinks.length) {
  const sectionMap = new Map();
  let ticking = false;

  sectionNavLinks.forEach((link) => {
    const targetId = link.getAttribute('href');

    if (!targetId || targetId === '#top' || targetId === '#home') {
      return;
    }

    const targetSection = document.querySelector(targetId);

    if (targetSection) {
      sectionMap.set(link, targetSection);
    }
  });

  const updateActiveMenuLink = () => {
    ticking = false;

    const headerHeight = siteHeader ? siteHeader.offsetHeight : 0;
    const triggerLine = headerHeight + 2;
    let activeLink = null;

    sectionMap.forEach((section, link) => {
      const rect = section.getBoundingClientRect();

      if (rect.top <= triggerLine && rect.bottom > triggerLine) {
        activeLink = link;
      }
    });

    sectionNavLinks.forEach((link) => {
      link.classList.toggle('is-active', link === activeLink);
    });
  };

  const requestActiveUpdate = () => {
    if (ticking) {
      return;
    }

    ticking = true;
    window.requestAnimationFrame(updateActiveMenuLink);
  };

  window.addEventListener('scroll', requestActiveUpdate, { passive: true });
  window.addEventListener('resize', requestActiveUpdate);
  window.addEventListener('load', requestActiveUpdate);

  requestActiveUpdate();
}

(function initHeroSymbol() {
  const wrap = document.querySelector('.hero-mark-wrap');
  const canvas = document.querySelector('.hero-mark-canvas');
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

    function animate() {
      displacement.lerp(displacementTarget, EFFECT_LERP);
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    interactionRegion.addEventListener('pointerenter', updatePointer);
    interactionRegion.addEventListener('pointerdown', onPointerDown);
    interactionRegion.addEventListener('pointermove', updatePointer);
    interactionRegion.addEventListener('pointerup', onPointerUp);
    interactionRegion.addEventListener('pointercancel', onPointerUp);
    interactionRegion.addEventListener('pointerleave', resetPointer);
    window.addEventListener('resize', resize);

    resize();
    animate();
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
