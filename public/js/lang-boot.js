// Runs synchronously in <head> so the page paints with the right direction,
// font, and theme before the module bundle loads. i18n.js / theme.js repeat
// this logic and keep the choices in sync with localStorage.
(function bootLanguageAndTheme() {
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

  // Theme: ?theme=dark|light|auto > saved hush:theme > auto (system).
  var themeMode = 'auto';
  try {
    var themeFromUrl = new URLSearchParams(window.location.search).get('theme');
    if (themeFromUrl === 'dark' || themeFromUrl === 'light' || themeFromUrl === 'auto') {
      themeMode = themeFromUrl;
      localStorage.setItem('hush:theme', themeFromUrl);
    } else {
      var savedTheme = localStorage.getItem('hush:theme');
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'auto') {
        themeMode = savedTheme;
      }
    }
  } catch (error) {
    themeMode = 'auto';
  }

  var theme = themeMode;
  if (themeMode === 'auto') {
    try {
      theme =
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    } catch {
      theme = 'light';
    }
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.thememode = themeMode;
  document.documentElement.style.colorScheme = theme;
})();
