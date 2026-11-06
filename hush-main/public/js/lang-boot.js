// Runs synchronously in <head> so the page paints with the right direction and
// font before the module bundle loads. i18n.js repeats this logic and keeps the
// language in sync with localStorage.
(function bootLanguage() {
  var SUPPORTED = { en: true, ar: true };
  var lang = 'en';

  try {
    var fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl && SUPPORTED[fromUrl]) {
      lang = fromUrl;
      localStorage.setItem('hush:lang', fromUrl);
    } else {
      var stored = localStorage.getItem('hush:lang');
      if (stored && SUPPORTED[stored]) {
        lang = stored;
      } else {
        var browser = String(navigator.language || 'en').toLowerCase();
        lang = browser.indexOf('ar') === 0 ? 'ar' : 'en';
      }
    }
  } catch (error) {
    // Storage may be blocked; the browser language still decides.
    try {
      var fallback = String(navigator.language || 'en').toLowerCase();
      lang = fallback.indexOf('ar') === 0 ? 'ar' : 'en';
    } catch {
      lang = 'en';
    }
  }

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.dataset.lang = lang;
})();
