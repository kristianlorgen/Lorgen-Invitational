(() => {
  const DISMISS_KEY = 'lorgen-install-dismissed-v1';
  let deferredPrompt = null;

  function createInstallPrompt() {
    if (document.getElementById('installPromptCard')) return;
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const wrap = document.createElement('aside');
    wrap.id = 'installPromptCard';
    wrap.className = 'install-prompt';
    wrap.innerHTML = `
      <button type="button" class="install-prompt__dismiss" aria-label="Lukk" data-action="dismiss">×</button>
      <p class="install-prompt__title">Installer Lorgen Invitational</p>
      <p class="install-prompt__desc">Få live leaderboard rett på hjemskjermen.</p>
      <div class="install-prompt__actions">
        <button type="button" class="btn btn--gold btn--sm" data-action="install">Installer</button>
        <button type="button" class="btn btn--outline btn--sm install-prompt__secondary" data-action="dismiss">Ikke nå</button>
      </div>
    `;

    wrap.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;

      if (action === 'dismiss') {
        localStorage.setItem(DISMISS_KEY, '1');
        wrap.remove();
      }

      if (action === 'install' && deferredPrompt) {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result?.outcome !== 'accepted') {
          localStorage.setItem(DISMISS_KEY, '1');
        }
        deferredPrompt = null;
        wrap.remove();
      }
    });

    document.body.appendChild(wrap);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    window.requestAnimationFrame(createInstallPrompt);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    localStorage.removeItem(DISMISS_KEY);
    document.getElementById('installPromptCard')?.remove();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('/service-worker.js');
      } catch (_) {}
    });
  }
})();
