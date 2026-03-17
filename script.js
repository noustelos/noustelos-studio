// Minimal script for mobile navigation toggle and close-on-click behavior.
const navToggle = document.querySelector('.nav-toggle');
const menu = document.querySelector('#site-menu');
const langToggle = document.querySelector('.lang-toggle');
const topLinks = document.querySelectorAll('.logo, .footer-top-link');
const siteHeader = document.querySelector('.site-header');
const sectionNavLinks = document.querySelectorAll('.menu a[href^="#"]');

const translations = {
  en: {
    meta: {
      title: 'Noustelos Studio | Web Design for Tourism & Creative Projects',
      description: 'Noustelos Studio creates modern websites for tourism brands, local businesses and creative projects.'
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
        desc: 'Experimental landing pages exploring visuals and storytelling.'
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
      email: 'Email'
    },
    footer: {
      labAria: 'Open UX Lab',
      universeAria: 'Open universe page',
      topAria: 'Back to top',
      rights: 'Designed in Santorini | © 2026 all rights reserved | In collaboration with WebHostPro'
    }
  },
  gr: {
    meta: {
      title: 'Noustelos Studio | Σχεδιασμός Ιστοσελίδων για Τουρισμό & Δημιουργικά Projects',
      description: 'Το Noustelos Studio δημιουργεί μοντέρνες ιστοσελίδες για τουριστικά brands, τοπικές επιχειρήσεις και δημιουργικά projects.'
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
        desc: 'Πειραματικά landing pages με έμφαση σε οπτική αφήγηση και storytelling.'
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
      email: 'Email'
    },
    footer: {
      labAria: 'Άνοιγμα UX Lab',
      universeAria: 'Άνοιγμα σελίδας universe',
      topAria: 'Επιστροφή στην κορυφή',
      rights: 'Σχεδιασμένο στη Σαντορίνη | © 2026 όλα τα δικαιώματα διατηρούνται | Σε συνεργασία με τη WebHostPro'
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
      element.textContent = value;
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

const preferredLanguage = (() => {
  const storedLang = localStorage.getItem('siteLanguage');

  if (storedLang === 'en' || storedLang === 'gr') {
    return storedLang;
  }

  return 'en';
})();

applyLanguage(preferredLanguage);

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
