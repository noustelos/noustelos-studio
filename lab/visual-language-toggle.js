(function initVisualLanguageToggle() {
  var langToggle = document.querySelector('.lang-toggle');
  var pageKey = document.body.getAttribute('data-i18n-page');

  if (!langToggle || !pageKey) {
    return;
  }

  var translations = {
    visualExperiments: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          eyebrow: 'Visual Experiments',
          intro: 'A hero study with layered depth, floating badges, and clear scroll rhythm for strong visual storytelling.',
          footerLabel: 'Back to UX Lab'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          eyebrow: 'Οπτικα Πειραματα',
          intro: 'Μια hero μελετη με layered βαθος, floating badges και καθαρο scroll rhythm για δυνατο visual storytelling.',
          footerLabel: 'Επιστροφη στο UX Lab'
        }
      }
    },
    codeFabric: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          eyebrow: 'Visual Experiments / Theme 02',
          intro: 'A tactile canvas experiment where code transforms into a cloth mesh and responds naturally to drag and release.',
          footerLabel: 'Back to UX Lab',
          stageHint: 'drag / disturb / release'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          eyebrow: 'Οπτικα Πειραματα / Θεμα 02',
          intro: 'Ενα tactile canvas πειραμα οπου ο κωδικας μετατρεπεται σε cloth mesh και αντιδρα φυσικα σε drag και release.',
          footerLabel: 'Επιστροφη στο UX Lab',
          stageHint: 'τραβηγμα / διαταραχη / απελευθερωση'
        }
      }
    },
    textSignal: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          kicker: 'Visual Experiments / Theme 03',
          intro: 'A pure CSS text study focused on rhythm, scroll-driven reveal, and bold hover inversion without JavaScript.',
          stageTitle: 'scroll reveal field',
          stageSubtitle: 'hover each line to invert the message',
          footerLabel: 'Back to UX Lab'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          kicker: 'Οπτικα Πειραματα / Θεμα 03',
          intro: 'Μια pure CSS text μελετη με εστιαση σε rhythm, scroll-driven reveal και εντονο hover inversion χωρις JavaScript.',
          stageTitle: 'πεδιο αποκαλυψης scroll',
          stageSubtitle: 'περασε το hover σε καθε γραμμη για αντιστροφη μηνυματος',
          footerLabel: 'Επιστροφη στο UX Lab'
        }
      }
    },
    waveGrid: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          pill: 'Visual Experiments / Study 05',
          kicker: 'Canvas Field',
          intro: 'A fullscreen geometric field that reacts to pointer proximity and builds wave pulses on each click.',
          centerPulse: 'Pulse from center',
          randomPulse: 'Random impact point',
          waveSpeed: 'Wave speed',
          footerLabel: 'Back to UX Lab'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          pill: 'Οπτικα Πειραματα / Study 05',
          kicker: 'Πεδιο Καμβα',
          intro: 'Ενα fullscreen γεωμετρικο πεδιο που αντιδρα στην εγγυτητα του pointer και χτιζει wave pulses σε καθε click.',
          centerPulse: 'Παλη απο το κεντρο',
          randomPulse: 'Τυχαιο σημειο κυματος',
          waveSpeed: 'Ταχυτητα κυματος',
          footerLabel: 'Επιστροφη στο UX Lab'
        }
      }
    },
    abyssDrift: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          kicker: 'Visual Experiment / Study 04',
          intro: 'A procedural underwater study with custom shader noise, wireframe terrain, and atmospheric motion.',
          stageCaption: 'Live WebGL scene',
          interactionTitle: 'Interaction',
          interactionBody: 'Drag to orbit around the object. Camera damping and fog keep motion smooth on mobile and desktop.',
          footerLabel: 'Back to UX Lab'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          kicker: 'Οπτικο Πειραμα / Study 04',
          intro: 'Μια procedural underwater μελετη με custom shader noise, wireframe terrain και ατμοσφαιρικη κινηση.',
          stageCaption: 'Ζωντανη WebGL σκηνη',
          interactionTitle: 'Αλληλεπιδραση',
          interactionBody: 'Συρε για orbit γυρω απο το αντικειμενο. Camera damping και fog κρατουν την κινηση ομαλη σε mobile και desktop.',
          footerLabel: 'Επιστροφη στο UX Lab'
        }
      }
    },
    videoExperiments: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          title: 'Video Experiments />',
          subtitle: 'Portrait study: Tree sequence.',
          videoAria: 'Tree portrait mode experiment video',
          footerLabel: 'Back to UX Lab'
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          title: 'Πειραματα Βιντεο />',
          subtitle: 'Μελετη καθετου καδρου: Tree sequence.',
          videoAria: 'Βιντεο πειραματος καθετου καδρου',
          footerLabel: 'Επιστροφη στο UX Lab'
        }
      }
    },
    spotlightNav: {
      en: {
        common: {
          switchAria: 'Switch language',
          backToLab: 'Back to UX Lab'
        },
        page: {
          pill: 'Visual Experiments / Study 06',
          kicker: 'Anchor Light Menu',
          titleLine2: 'Navigation',
          intro: 'A navigation concept where anchor-positioned beams project from moving light heads and follow hover focus in real time.',
          description: 'Description: This study explores CSS Anchor Positioning for synchronized light beams, dynamic focus cues, and cinematic menu feedback.',
          footerLabel: 'Back to UX Lab',
          menu: {
            home: 'Home',
            about: 'About us',
            products: 'Products',
            contact: 'Contact'
          }
        }
      },
      gr: {
        common: {
          switchAria: 'Αλλαγη γλωσσας',
          backToLab: 'Επιστροφη στο UX Lab'
        },
        page: {
          pill: 'Οπτικα Πειραματα / Study 06',
          kicker: 'Μελετη Φωτεινου Μενού',
          titleLine2: 'Πλοηγηση',
          intro: 'Ενα navigation concept οπου anchor-positioned beams προβαλλονται απο moving light heads και ακολουθουν το hover focus σε πραγματικο χρονο.',
          description: 'Περιγραφη: Αυτη η μελετη εξερευνα το CSS Anchor Positioning για συγχρονισμενες φωτεινες δεσμες, dynamic focus cues και κινηματογραφικο menu feedback.',
          footerLabel: 'Επιστροφη στο UX Lab',
          menu: {
            home: 'Αρχικη',
            about: 'Σχετικα',
            products: 'Προϊοντα',
            contact: 'Επικοινωνια'
          }
        }
      }
    }
  };

  var dictionary = translations[pageKey];

  if (!dictionary) {
    return;
  }

  var getNestedValue = function getNestedValue(obj, path) {
    return path.split('.').reduce(function reduce(acc, key) {
      return acc && acc[key] !== undefined ? acc[key] : null;
    }, obj);
  };

  var applyLanguage = function applyLanguage(lang) {
    var safeLang = dictionary[lang] ? lang : 'en';
    var langContent = dictionary[safeLang];

    document.documentElement.lang = safeLang === 'gr' ? 'el' : 'en';

    document.querySelectorAll('[data-i18n]').forEach(function updateText(element) {
      var key = element.getAttribute('data-i18n');
      var value = getNestedValue(langContent, key);

      if (typeof value === 'string') {
        if (value.indexOf('<em>') !== -1 || value.indexOf('</em>') !== -1) {
          element.innerHTML = value;
        } else {
          element.textContent = value;
        }
      }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function updateAttrs(element) {
      element
        .getAttribute('data-i18n-attr')
        .split(';')
        .map(function trim(entry) {
          return entry.trim();
        })
        .filter(Boolean)
        .forEach(function applyMapping(mapping) {
          var parts = mapping.split(':').map(function trim(part) {
            return part.trim();
          });

          var attrName = parts[0];
          var key = parts[1];
          var value = getNestedValue(langContent, key);

          if (attrName && typeof value === 'string') {
            element.setAttribute(attrName, value);
          }
        });
    });

    langToggle.querySelectorAll('[data-lang-option]').forEach(function toggleActive(option) {
      var optionLang = option.getAttribute('data-lang-option');
      option.classList.toggle('is-active', optionLang === safeLang);
    });

    localStorage.setItem('siteLanguage', safeLang);
  };

  var storedLang = localStorage.getItem('siteLanguage');
  var preferredLanguage = storedLang === 'en' || storedLang === 'gr' ? storedLang : 'en';

  applyLanguage(preferredLanguage);

  langToggle.addEventListener('click', function onToggleClick() {
    var currentLang = localStorage.getItem('siteLanguage') || preferredLanguage;
    var nextLang = currentLang === 'en' ? 'gr' : 'en';
    applyLanguage(nextLang);
  });
})();
