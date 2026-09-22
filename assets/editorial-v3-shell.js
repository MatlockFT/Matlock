(() => {
  const page = document.querySelector('[data-editorial-v3]');
  if (!page) return;

  const setupFixedRail = () => {
    const header = document.querySelector('.site-header');
    const navigation = document.querySelector('.site-navigation');
    if (!header || !navigation || document.querySelector('[data-v3-sticky-shell]')) return;

    const shell = document.createElement('div');
    shell.className = 'v3-sticky-shell';
    shell.dataset.v3StickyShell = '';
    header.insertAdjacentElement('beforebegin', shell);
    shell.append(navigation);

    header.querySelector('.site-live-strip-reserve')?.remove();

    const syncRailHeight = () => {
      const height = Math.ceil(shell.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--v3-fixed-rail-height', `${height}px`);
    };

    const adoptTicker = () => {
      const ticker = document.querySelector('.site-live-strip');
      if (ticker && ticker.parentElement !== shell) shell.prepend(ticker);
      syncRailHeight();
    };

    const insertionObserver = new MutationObserver(adoptTicker);
    insertionObserver.observe(document.body, { childList: true, subtree: true });

    const sizeObserver = new ResizeObserver(syncRailHeight);
    sizeObserver.observe(shell);

    window.addEventListener('resize', syncRailHeight, { passive: true });
    adoptTicker();
    requestAnimationFrame(syncRailHeight);
  };

  const setupThemeTransition = () => {
    const toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle) return;

    let cleanupTimer = 0;
    toggle.addEventListener('click', () => {
      const html = document.documentElement;
      html.classList.add('v3-theme-transitioning');
      window.clearTimeout(cleanupTimer);
      cleanupTimer = window.setTimeout(() => {
        html.classList.remove('v3-theme-transitioning');
      }, 420);
    }, { capture: true });
  };

  setupFixedRail();
  setupThemeTransition();
})();
