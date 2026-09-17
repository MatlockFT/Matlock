(() => {
  const version = '20260917-ux1';
  const head = document.head;

  function loadStyle(href) {
    if (document.querySelector('link[data-writer-ux-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${href}?v=${version}`;
    link.dataset.writerUxStyle = '';
    head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${src}?v=${version}`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      head.appendChild(script);
    });
  }

  loadStyle('/assets/writer-ux.css');
  loadScript('/assets/writer-wordtools-core.js')
    .then(() => loadScript('/assets/writer-ux.js'))
    .catch(error => console.error('[Writer]', error));
})();
