import Toast from 'bootstrap/js/src/toast';

if ('serviceWorker' in navigator) {
  // Get Jekyll config from URL parameters
  const src = new URL(document.currentScript.src);
  const register = src.searchParams.get('register') === 'true';
  const baseUrl = src.searchParams.get('baseurl') || '';

  if (register) {
    const swUrl = `${baseUrl}/sw.min.js`;
    const notification = document.getElementById('notification');
    const btnRefresh = notification.querySelector('.toast-body>button');
    const popupWindow = Toast.getOrCreateInstance(notification);

    navigator.serviceWorker
      .register(swUrl, { updateViaCache: 'none' })
      .then((registration) => {
        const showUpdate = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            popupWindow.show();
          }
        };

        const watchInstalling = () => {
          const worker = registration.installing;
          if (worker) {
            worker.addEventListener('statechange', showUpdate);
          }
          showUpdate();
        };

        registration.addEventListener('updatefound', watchInstalling);
        // Navigation may start an update before register() resolves.
        watchInstalling();

        const checkInterval = 60 * 1000;
        let lastCheck = -Infinity;
        let checking = false;

        const checkForUpdates = async () => {
          showUpdate();

          if (
            navigator.onLine === false ||
            document.visibilityState === 'hidden' ||
            registration.installing ||
            checking ||
            Date.now() - lastCheck < checkInterval
          ) {
            return;
          }

          lastCheck = Date.now();
          checking = true;

          try {
            await registration.update();
          } catch (error) {
            lastCheck = -Infinity;
            console.warn('[PWA] Update check failed:', error);
          } finally {
            checking = false;
          }
        };

        window.addEventListener('pageshow', checkForUpdates);
        window.addEventListener('online', checkForUpdates);
        document.addEventListener('visibilitychange', checkForUpdates);
        checkForUpdates();

        btnRefresh.addEventListener('click', () => {
          if (registration.waiting) {
            registration.waiting.postMessage('SKIP_WAITING');
          }
          popupWindow.hide();
        });
      })
      .catch((error) => {
        console.warn('[PWA] Registration failed:', error);
      });

    let refreshing = false;

    // Detect controller change and refresh all the opened tabs
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  } else {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      for (let registration of registrations) {
        registration.unregister();
      }
    });
  }
}
