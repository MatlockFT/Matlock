(() => {
  'use strict';

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  };

  const resizeObservers = new WeakMap();

  function cropValues(img, options = {}) {
    return {
      x: clamp(options.x ?? img.dataset.portraitX, 0, 100, 50),
      y: clamp(options.y ?? img.dataset.portraitY, 0, 100, 50),
      zoom: clamp(options.zoom ?? img.dataset.portraitZoom, 100, 250, 100)
    };
  }

  function ensureCanvas(img, frame) {
    let canvas = frame.querySelector(':scope > canvas.matlock-portrait-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'matlock-portrait-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.tabIndex = -1;
      frame.insertBefore(canvas, img);
    }
    return canvas;
  }

  function clearFrame(img, frame) {
    frame.classList.remove('portrait-canvas-ready');
    const canvas = frame.querySelector(':scope > canvas.matlock-portrait-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    delete canvas.dataset.portraitRender;
  }

  function observeFrame(img, frame) {
    if (!window.ResizeObserver || resizeObservers.has(img)) return;
    const observer = new ResizeObserver(() => render(img));
    observer.observe(frame);
    resizeObservers.set(img, observer);
  }

  function render(img, options = {}) {
    if (!(img instanceof HTMLImageElement)) return false;
    const frame = options.frame || img.closest('.fc-portrait, .writer-tale-portrait') || img.parentElement;
    if (!(frame instanceof HTMLElement)) return false;

    const values = cropValues(img, options);
    img.dataset.portraitX = String(values.x);
    img.dataset.portraitY = String(values.y);
    img.dataset.portraitZoom = String(values.zoom);

    if (!img.currentSrc && !img.src) {
      clearFrame(img, frame);
      return false;
    }

    if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
      clearFrame(img, frame);
      if (!img.dataset.portraitLoadBound) {
        img.dataset.portraitLoadBound = 'true';
        img.addEventListener('load', () => {
          delete img.dataset.portraitLoadBound;
          render(img);
        }, { once: true });
      }
      return false;
    }

    const frameRect = frame.getBoundingClientRect();
    const frameWidth = Math.max(1, frameRect.width || frame.clientWidth || 1);
    const frameHeight = Math.max(1, frameRect.height || frame.clientHeight || 1);
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    const canvas = ensureCanvas(img, frame);
    const pixelWidth = Math.max(1, Math.round(frameWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(frameHeight * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const context = canvas.getContext('2d');
    if (!context) return false;

    const coverScale = Math.max(
      frameWidth / img.naturalWidth,
      frameHeight / img.naturalHeight
    );
    const zoomScale = values.zoom / 100;
    const drawWidth = img.naturalWidth * coverScale * zoomScale;
    const drawHeight = img.naturalHeight * coverScale * zoomScale;

    const maxShiftX = Math.max(0, (drawWidth - frameWidth) / 2);
    const maxShiftY = Math.max(0, (drawHeight - frameHeight) / 2);
    const shiftX = ((values.x - 50) / 50) * maxShiftX;
    const shiftY = ((values.y - 50) / 50) * maxShiftY;
    const left = (frameWidth - drawWidth) / 2 + shiftX;
    const top = (frameHeight - drawHeight) / 2 + shiftY;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.save();
    context.beginPath();
    context.ellipse(
      frameWidth / 2,
      frameHeight / 2,
      frameWidth / 2,
      frameHeight / 2,
      0,
      0,
      Math.PI * 2
    );
    context.clip();
    context.drawImage(img, left, top, drawWidth, drawHeight);
    context.restore();

    canvas.dataset.portraitRender = JSON.stringify({
      x: values.x,
      y: values.y,
      zoom: values.zoom,
      frameWidth,
      frameHeight,
      sourceWidth: img.naturalWidth,
      sourceHeight: img.naturalHeight,
      left,
      top,
      drawWidth,
      drawHeight,
      leftRatio: left / frameWidth,
      topRatio: top / frameHeight,
      widthRatio: drawWidth / frameWidth,
      heightRatio: drawHeight / frameHeight
    });

    frame.classList.add('portrait-canvas-ready');
    observeFrame(img, frame);
    return true;
  }

  function configFor(section) {
    try {
      return JSON.parse(decodeURIComponent(section.dataset.writerConfig || ''));
    } catch {
      return null;
    }
  }

  function hydrateSection(section) {
    const config = configFor(section);
    if (!config) return;
    const pairs = [
      [section.querySelector('.fc-left .fc-portrait img[data-portrait-source], .fc-left .fc-portrait img'), config.a],
      [section.querySelector('.fc-right .fc-portrait img[data-portrait-source], .fc-right .fc-portrait img'), config.b]
    ];
    for (const [img, fighter] of pairs) {
      if (!img || !fighter) continue;
      render(img, {
        x: fighter.x ?? 50,
        y: fighter.y ?? 50,
        zoom: fighter.zoom ?? 100
      });
    }
  }

  function hydrate(root = document) {
    if (root.matches?.('section[data-writer-block="tale"]')) hydrateSection(root);
    root.querySelectorAll?.('section[data-writer-block="tale"]').forEach(hydrateSection);
  }

  window.MatlockPortraitCrop = {
    apply: render,
    render,
    hydrate
  };

  hydrate();

  let mutationTimer = 0;
  const observer = new MutationObserver(mutations => {
    const roots = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) roots.push(node);
      }
    }
    if (!roots.length) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => roots.forEach(hydrate), 20);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
