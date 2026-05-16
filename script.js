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
const contactFormNote = contactForm ? contactForm.querySelector('.contact-form-note') : null;
const contactSubmitButton = contactForm ? contactForm.querySelector('[type="submit"]') : null;
const recaptchaTokenInput = contactForm ? contactForm.querySelector('[name="g-recaptcha-response"]') : null;
const recaptchaSiteKeyMeta = document.querySelector('meta[name="recaptcha-site-key"]');
const recaptchaSiteKey = ((recaptchaSiteKeyMeta ? recaptchaSiteKeyMeta.getAttribute('content') : '') || '').trim();
const recaptchaPlaceholderPattern = /^(?:REPLACE_WITH|YOUR_)/i;
const isRecaptchaConfigured = Boolean(recaptchaSiteKey && !recaptchaPlaceholderPattern.test(recaptchaSiteKey));
const cookieBanner = document.querySelector('#cookie-banner');
const cookieAccept = document.querySelector('#cookie-accept');
const cookieDecline = document.querySelector('#cookie-decline');
const isIpadLikeDevice =
  /iPad/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

if (isIpadLikeDevice) {
  documentRoot.classList.add('is-ipad');
}

const safeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_e) {
      // Storage unavailable (e.g. Safari private mode).
    }
  }
};

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
      description: 'Noustelos Studio creates custom AI-assisted websites, landing pages and creative web projects in Santorini, shaped with human design judgment and final QA.'
    },
    nav: {
      mainAria: 'Main navigation',
      toggleAria: 'Toggle menu',
      work: 'Work',
      services: 'Services',
      about: 'About',
      contact: 'Contact',
      chatbot: 'Chat AI'
    },
    lang: {
      switchAria: 'Switch language'
    },
    hero: {
      title: 'Websites with Clarity, Character & Direction',
      subtitle: 'Custom digital builds for tourism, hospitality and creative ideas, designed in Santorini and refined with AI-assisted workflows.',
      intro: 'Designed and built by Nick Karadimas',
      ctaWork: 'View My Work',
      ctaContact: 'Contact'
    },
    work: {
      title: 'Selected Work',
      viewProject: 'View Project',
      project1: {
        alt: '365orthodoxy project preview',
        desc: 'A focused landing page for an Orthodox calendar widget, helping visitors understand the product and its daily value quickly.'
      },
      project3: {
        alt: 'Vouraikos Gorge project preview',
          desc: 'A destination website for Vouraikos Gorge, presenting the UNESCO Global Geopark with concise information and a sense of place.'
      },
      project4: {
        alt: 'Odontotos railway project preview',
        desc: 'A tourism page for the Odontotos railway and Vouraikos Gorge, built around video, clear trip context and mobile-first discovery.'
      },
      project5: {
        alt: 'Honeymoon Beach Studios project preview',
        desc: 'A clean hotel page for a family-owned stay, designed to present rooms, location and booking context without unnecessary noise.'
      },
      project6: {
        alt: 'Daily Inspiration Widget project preview',
        desc: 'A daily inspiration widget for Orthodox readers, pairing Bible passages and feast-day reminders with a quiet, app-like interface.'
      },
      project7: {
        alt: 'Artemis project preview',
        title: 'Ethical dog training and care',
        desc: "A calm landing page for Artemis Antoniou's dog behavior guide, combining editorial copy, a quiz and trust-led product storytelling."
      },
      project8: {
        alt: 'Water Cycle Systems project preview',
        desc: 'A service landing page for pool care in Santorini, giving homeowners and businesses a clear view of maintenance options.'
      }
    },
    services: {
      title: 'Services',
      card1: {
        title: 'Website Design',
        desc: 'Custom responsive websites for hotels, tourism projects, local businesses and independent brands that need a clear, polished online presence.'
      },
      card2: {
        title: 'Landing Pages',
        desc: 'Focused landing pages for campaigns, products and services, built to explain the offer quickly and guide visitors toward action.'
      },
      card3: {
        title: 'Creative Web Projects',
        desc: 'Visual storytelling, interactive sections and experimental web concepts for projects that need more character than a standard business page.'
      },
      card4: {
        title: 'AI Lab',
        desc: 'AI-assisted tools, bots and content systems designed around real business needs, useful context and a clear personality.',
        cta: 'View the Live Demo'
      }
    },
    about: {
      title: 'About',
      p1: "I'm Nick Karadimas, a creative web designer and developer based in Santorini.",
      p2: 'I build custom websites and landing pages for tourism, hospitality, local businesses and creative projects. My work combines clear structure, visual storytelling, responsive design and practical functionality.',
      p3: 'I use AI-assisted workflows to move faster, explore stronger directions and refine details, but every project is shaped through human judgment, taste and final quality control. The goal is not to produce another template. The goal is to create a site that feels specific, useful and well-directed.'
    },
    contact: {
      title: "Let's Work Together",
      text: 'If you have a project that needs clear structure, strong visual direction and a clean online presence, get in touch.',
      email: 'Email Nick',
      github: 'GitHub Profile',
      directEmail: 'Studio Email',
      form: {
        nameLabel: 'Your name',
        messageLabel: 'Project brief',
        submit: 'Open email draft',
        note: 'This opens your email app with the message ready.',
        checking: 'Checking request...',
        opening: 'Opening email draft...',
        verificationError: 'We could not verify this request. Please try again.'
      }
    },
    chatbot: {
      button: 'AI Chat',
      openAria: 'Open AI Chat'
    },
    footer: {
      labAria: 'Open UX Lab',
      universeAria: 'Open universe page',
      topAria: 'Back to top',
      rights: 'Designed in Santorini | © {{year}} all rights reserved | In collaboration with <a href="https://webhostpro.gr/" target="_blank" rel="noopener noreferrer">WebHostPro</a>',
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
      description: 'Το Noustelos Studio δημιουργεί custom AI-assisted ιστοσελίδες, landing pages και creative web projects στη Σαντορίνη, με ανθρώπινη σχεδιαστική κρίση και τελικό QA.'
    },
    nav: {
      mainAria: 'Κύρια πλοήγηση',
      toggleAria: 'Εναλλαγή μενού',
      work: 'Portfolio',
      services: 'Υπηρεσίες',
      about: 'Σχετικά',
      contact: 'Επικοινωνία',
      chatbot: 'Chat AI'
    },
    lang: {
      switchAria: 'Αλλαγή γλώσσας'
    },
    hero: {
      title: 'Ιστοσελίδες με Σαφήνεια, Χαρακτήρα & Κατεύθυνση',
      subtitle: 'Custom digital builds για τουρισμό, φιλοξενία και δημιουργικές ιδέες, σχεδιασμένα στη Σαντορίνη και refined με AI-assisted workflows.',
      intro: 'Σχεδιασμός και ανάπτυξη: Νίκος Καραδήμας',
      ctaWork: 'Δες τη Δουλειά μου',
      ctaContact: 'Επικοινωνία'
    },
    work: {
      title: 'Επιλεγμένα Έργα',
      viewProject: 'Δες το Project',
      project1: {
        alt: 'Προεπισκόπηση project 365orthodoxy',
        desc: 'Στοχευμένο landing page για Orthodox calendar widget, ώστε οι επισκέπτες να καταλαβαίνουν γρήγορα το προϊόν και την καθημερινή του αξία.'
      },
      project3: {
        alt: 'Προεπισκόπηση project Φαράγγι Βουραϊκού',
          desc: 'Destination website για το Φαράγγι Βουραϊκού, που παρουσιάζει το UNESCO Global Geopark με καθαρή πληροφορία και αίσθηση τόπου.'
      },
      project4: {
        alt: 'Προεπισκόπηση project Οδοντωτός σιδηρόδρομος',
        desc: 'Τουριστική σελίδα για τον Οδοντωτό και το Φαράγγι Βουραϊκού, με video, ξεκάθαρο trip context και mobile-first ανακάλυψη.'
      },
      project5: {
        alt: 'Προεπισκόπηση project Honeymoon Beach Studios',
        desc: 'Καθαρή hotel σελίδα για οικογενειακή διαμονή, σχεδιασμένη να παρουσιάζει δωμάτια, τοποθεσία και booking context χωρίς περιττό θόρυβο.'
      },
      project6: {
        alt: 'Προεπισκόπηση project Daily Inspiration Widget',
        desc: 'Daily inspiration widget για Ορθόδοξους αναγνώστες, με βιβλικά αποσπάσματα, υπενθυμίσεις εορτολογίου και ήσυχο app-like interface.'
      },
      project7: {
        alt: 'Προεπισκόπηση project Artemis',
        title: 'Ηθική εκπαίδευση και φροντίδα σκύλων',
        desc: 'Ήρεμο landing page για τον οδηγό συμπεριφοράς σκύλων της Artemis Antoniou, με editorial κείμενο, quiz και trust-led product storytelling.'
      },
      project8: {
        alt: 'Προεπισκόπηση project Water Cycle Systems',
        desc: 'Service landing page για φροντίδα πισίνας στη Σαντορίνη, δίνοντας σε ιδιοκτήτες και επιχειρήσεις καθαρή εικόνα των υπηρεσιών.'
      }
    },
    services: {
      title: 'Υπηρεσίες',
      card1: {
        title: 'Σχεδιασμός Ιστοσελίδων',
        desc: 'Custom responsive ιστοσελίδες για ξενοδοχεία, τουριστικά projects, τοπικές επιχειρήσεις και ανεξάρτητα brands που χρειάζονται καθαρή, προσεγμένη online παρουσία.'
      },
      card2: {
        title: 'Landing Pages',
        desc: 'Στοχευμένα landing pages για καμπάνιες, προϊόντα και υπηρεσίες, χτισμένα για να εξηγούν γρήγορα την πρόταση και να οδηγούν τον επισκέπτη σε δράση.'
      },
      card3: {
        title: 'Δημιουργικά Web Projects',
        desc: 'Visual storytelling, διαδραστικές ενότητες και πειραματικά web concepts για projects που χρειάζονται περισσότερο χαρακτήρα από μια απλή business σελίδα.'
      },
      card4: {
        title: 'AI Lab',
        desc: 'AI-assisted εργαλεία, bots και content systems σχεδιασμένα γύρω από πραγματικές ανάγκες, χρήσιμο context και ξεκάθαρη προσωπικότητα.',
        cta: 'Δείτε το Live Demo'
      }
    },
    about: {
      title: 'Σχετικά',
      p1: 'Είμαι ο Νίκος Καραδήμας, creative web designer και developer με βάση τη Σαντορίνη.',
      p2: 'Χτίζω custom ιστοσελίδες και landing pages για τουρισμό, φιλοξενία, τοπικές επιχειρήσεις και δημιουργικά projects. Η δουλειά μου συνδυάζει καθαρή δομή, visual storytelling, responsive design και πρακτική λειτουργικότητα.',
      p3: 'Χρησιμοποιώ AI-assisted workflows για να κινούμαι πιο γρήγορα, να εξερευνώ πιο δυνατές κατευθύνσεις και να τελειοποιώ λεπτομέρειες, αλλά κάθε project διαμορφώνεται μέσα από ανθρώπινη κρίση, γούστο και τελικό quality control. Ο στόχος δεν είναι να παραχθεί άλλο ένα template. Ο στόχος είναι να δημιουργηθεί ένα site που νιώθει συγκεκριμένο, χρήσιμο και καλά κατευθυνόμενο.'
    },
    contact: {
      title: 'Ας Συνεργαστούμε',
      text: 'Αν έχεις ένα project που χρειάζεται καθαρή δομή, δυνατή οπτική κατεύθυνση και προσεγμένη online παρουσία, επικοινώνησε μαζί μου.',
      email: 'Email στον Νίκο',
      github: 'GitHub Profile',
      directEmail: 'Studio Email',
      form: {
        nameLabel: 'Το όνομά σου',
        messageLabel: 'Σύντομο project brief',
        submit: 'Άνοιγμα email draft',
        note: 'Ανοίγει την εφαρμογή email με το μήνυμα έτοιμο.',
        checking: 'Γίνεται έλεγχος αιτήματος...',
        opening: 'Άνοιγμα email draft...',
        verificationError: 'Δεν μπορέσαμε να επαληθεύσουμε το αίτημα. Δοκίμασε ξανά.'
      }
    },
    chatbot: {
      button: 'AI Chat',
      openAria: 'Άνοιγμα AI Chat'
    },
    footer: {
      labAria: 'Άνοιγμα UX Lab',
      universeAria: 'Άνοιγμα σελίδας universe',
      topAria: 'Επιστροφή στην κορυφή',
      rights: 'Σχεδιασμένο στη Σαντορίνη | © {{year}} όλα τα δικαιώματα διατηρούνται | Σε συνεργασία με τη <a href="https://webhostpro.gr/" target="_blank" rel="noopener noreferrer">WebHostPro</a>',
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
      const resolvedValue = value.replace('{{year}}', currentYear);

      if (key === 'footer.rights') {
        element.innerHTML = resolvedValue;
      } else {
        element.textContent = resolvedValue;
      }
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

  safeStorage.set('siteLanguage', safeLang);
};

const applyDynamicYear = () => {
  document.querySelectorAll('[data-current-year]').forEach((element) => {
    element.textContent = currentYear;
  });
};

const getCurrentLanguageContent = () => {
  const storedLang = safeStorage.get('siteLanguage');
  const safeLang = translations[storedLang] ? storedLang : 'en';

  return translations[safeLang];
};

const setContactFormNote = (key) => {
  if (!contactFormNote) {
    return;
  }

  const value = getNestedValue(getCurrentLanguageContent(), key);

  if (typeof value === 'string') {
    contactFormNote.textContent = value;
  }
};

const loadRecaptcha = (() => {
  let recaptchaLoadPromise = null;

  return () => {
    if (!isRecaptchaConfigured) {
      return Promise.resolve(null);
    }

    if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
      return Promise.resolve(window.grecaptcha);
    }

    if (recaptchaLoadPromise) {
      return recaptchaLoadPromise;
    }

    recaptchaLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`;
      script.async = true;
      script.defer = true;
      script.dataset.recaptchaV3 = 'true';
      script.onload = () => resolve(window.grecaptcha || null);
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return recaptchaLoadPromise;
  };
})();

const executeRecaptcha = async (action) => {
  if (!isRecaptchaConfigured) {
    return null;
  }

  const grecaptcha = await loadRecaptcha();

  if (!grecaptcha || typeof grecaptcha.ready !== 'function' || typeof grecaptcha.execute !== 'function') {
    throw new Error('reCAPTCHA is unavailable');
  }

  return new Promise((resolve, reject) => {
    grecaptcha.ready(() => {
      grecaptcha.execute(recaptchaSiteKey, { action }).then(resolve).catch(reject);
    });
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

  contactForm.querySelectorAll('input, textarea').forEach((field) => {
    field.addEventListener('input', () => {
      field.classList.remove('is-invalid');
    });
  });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const botField = (formData.get('website') || '').toString().trim();

    if (botField) {
      return;
    }

    const nameInput = contactForm.querySelector('[name="name"]');
    const messageInput = contactForm.querySelector('[name="message"]');
    const name = (formData.get('name') || '').toString().trim();
    const message = (formData.get('message') || '').toString().trim();

    nameInput && nameInput.classList.remove('is-invalid');
    messageInput && messageInput.classList.remove('is-invalid');

    if (!name || !message) {
      if (!name && nameInput) nameInput.classList.add('is-invalid');
      if (!message && messageInput) messageInput.classList.add('is-invalid');
      return;
    }

    if (contactSubmitButton) {
      contactSubmitButton.disabled = true;
    }

    try {
      setContactFormNote(isRecaptchaConfigured ? 'contact.form.checking' : 'contact.form.note');
      const recaptchaToken = await executeRecaptcha('contact_submit');

      if (recaptchaTokenInput) {
        recaptchaTokenInput.value = recaptchaToken || '';
      }
    } catch (_error) {
      setContactFormNote('contact.form.verificationError');

      if (contactSubmitButton) {
        contactSubmitButton.disabled = false;
      }

      return;
    }

    const subject = encodeURIComponent(`Project inquiry from ${name}`);
    const body = encodeURIComponent(`Name: ${name}\n\nProject brief:\n${message}`);
    
    if (contactFormNote) {
      contactFormNote.textContent = ''; // Clear it to avoid double announcement
    }
    
    const statusEl = document.querySelector('#contact-status');
    if (statusEl) {
      statusEl.textContent = getNestedValue(getCurrentLanguageContent(), 'contact.form.opening') || 'Opening email draft...';
    }

    window.location.href = `mailto:info@noustelos.gr?subject=${subject}&body=${body}`;

    window.setTimeout(() => {
      if (contactSubmitButton) {
        contactSubmitButton.disabled = false;
      }

      setContactFormNote('contact.form.note');
    }, 1200);
  });
};

const setupCookieConsent = () => {
  if (!cookieBanner || !cookieAccept || !cookieDecline) {
    return;
  }

  const consentKey = 'siteCookieConsent';
  const existingConsent = safeStorage.get(consentKey);

  if (!existingConsent) {
    cookieBanner.hidden = false;
  }

  const setConsent = (value) => {
    safeStorage.set(consentKey, value);
    cookieBanner.hidden = true;
  };

  cookieAccept.addEventListener('click', () => setConsent('accepted'));
  cookieDecline.addEventListener('click', () => setConsent('declined'));
};

const preferredLanguage = (() => {
  const storedLang = safeStorage.get('siteLanguage');

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

if (isRecaptchaConfigured) {
  loadRecaptcha().catch(() => {
    // Keep contact flow functional even if Google script is blocked.
  });
}

if (navToggle && menu) {
  const menuLinks = menu.querySelectorAll('a');
  const firstFocusable = navToggle;
  const lastFocusable = menuLinks[menuLinks.length - 1];

  const toggleMenu = (forceClose = false) => {
    const isOpen = forceClose ? false : !menu.classList.contains('open');
    menu.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
    
    // Manage inert or visibility if needed, but here we just manage focus
    if (isOpen) {
      // Small delay to ensure menu is visible before focusing if needed, 
      // but let's stick to standard behavior.
    }
  };

  navToggle.addEventListener('click', () => toggleMenu());

  menuLinks.forEach((link) => {
    link.addEventListener('click', () => toggleMenu(true));
  });

  // Esc key support
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (menu.classList.contains('open')) {
        toggleMenu(true);
        navToggle.focus();
      }
      if (cookieBanner && !cookieBanner.hidden) {
        cookieBanner.hidden = true;
      }
    }
    
    // Focus Trap for Menu
    if (e.key === 'Tab' && menu.classList.contains('open')) {
      if (e.shiftKey) { // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else { // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }
  });
}

if (langToggle) {
  langToggle.addEventListener('click', () => {
    const currentLang = safeStorage.get('siteLanguage') || preferredLanguage;
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

// Scroll reveal animation
(function () {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const style = document.createElement('style');
  style.textContent = [
    '.reveal{opacity:0;transform:translateY(22px);transition:opacity 440ms ease,transform 440ms ease}',
    '.reveal.is-visible{opacity:1;transform:translateY(0)}'
  ].join('');
  document.head.appendChild(style);

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );

  document
    .querySelectorAll('.project-card, .service-card, .section-heading, .about-block p, .contact-block p')
    .forEach(function (el) {
      el.classList.add('reveal');
      observer.observe(el);
    });
})();
