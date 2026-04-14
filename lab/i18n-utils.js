/* Shared i18n utilities for UX Lab pages.
 * Must be loaded before lab.js / visual-language-toggle.js. */
(function (global) {
  global.i18nUtils = {
    safeStorage: {
      get: function (key) {
        try { return localStorage.getItem(key); } catch (_e) { return null; }
      },
      set: function (key, value) {
        try { localStorage.setItem(key, value); } catch (_e) {}
      }
    },
    getNestedValue: function (obj, path) {
      return path.split('.').reduce(function (acc, key) {
        return acc && acc[key] !== undefined ? acc[key] : null;
      }, obj);
    }
  };
}(window));
