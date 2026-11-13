/* PWA bootstrap: register the service worker and wire "Add to Home Screen".
   Loaded as a classic script so it also runs on the 404 page. */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* HTTP on a LAN address: installability needs HTTPS or localhost. */
      });
    });
  }

  var deferredPrompt = null;

  function installButtons() {
    return document.querySelectorAll('[data-pwa-install]');
  }

  function showInstall(show) {
    document.documentElement.dataset.canInstall = show ? '1' : '0';
    installButtons().forEach(function (node) {
      node.hidden = !show;
    });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showInstall(true);
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    showInstall(false);
  });

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest && event.target.closest('[data-pwa-install]');
    if (!button) return;
    if (!deferredPrompt) {
      showInstall(false);
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
      showInstall(false);
    });
  });
})();
