if (!document.body.classList.contains('page-id-42')) {
  // Run this script only on the lab page scope.
} else {
  const PAGE_SCOPE = 'body.page-id-42';
  const langToggle = document.querySelector(`${PAGE_SCOPE} .lang-toggle`);

  const translations = {
    en: {
      meta: {
        title: 'UX Lab | Noustelos Studio',
        description: 'UX Lab by Noustelos Studio: experimental web works, micro-interactions and creative concepts.'
      },
      lang: {
        switchAria: 'Switch language'
      },
      lab: {
        eyebrow: 'Early Access',
        title: 'UX <em>Lab</em>',
        intro: 'Welcome to the hidden workshop. Here you will find experimental concepts, interaction studies and ideas still in exploration mode.',
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
        title: 'UX Lab | Noustelos Studio',
        description: 'UX Lab από το Noustelos Studio: πειραματικά web works, micro-interactions και creative concepts.'
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
        if (value.includes('<em>') || value.includes('</em>')) {
          element.innerHTML = value;
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

  if (langToggle) {
    langToggle.addEventListener('click', () => {
      const currentLang = localStorage.getItem('siteLanguage') || preferredLanguage;
      const nextLang = currentLang === 'en' ? 'gr' : 'en';
      applyLanguage(nextLang);
    });
  }

  document.addEventListener('mousemove', (e) => {
    const nebula = document.querySelector(`${PAGE_SCOPE} .lab-nebula`);
    if (!nebula) return;

    const x = (e.clientX / window.innerWidth - 0.5) * 20;
    const y = (e.clientY / window.innerHeight - 0.5) * 20;

    nebula.style.transform = `translate(${x}px,${y}px) scale(1.05)`;
  });
}
