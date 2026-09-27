(() => {
  'use strict';

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  };

  const resizeObservers = new WeakMap();

  function valuesFor(img, options = {}) {
    return {
      x: clamp(options.x ?? img.dataset.portraitX, 0, 100, 50),
      y: clamp(options.y ?? img.dataset.portraitY, 0, 100, 50),
      zoom: clamp(options.zoom ?? img.dataset.portraitZoom, 100, 250, 100)
    };
  }

  function setFallback(img) {
    const important = (name, value) => img.style.setProperty(name, value, 'important');
    important('position', 'absolute');
    important('inset', '0');
    important('left', '0');
    important('top', '0');
    important('right', 'auto');
    important('bottom', 'auto');
    important('width', '100%');
    important('height', '100%');
    important('max-width', 'none');
    important('object-fit', 'cover');
    important('object-position', '50% 50%');
    important('transform', 'none');
    important('transform-origin', '50% 50%');
  }

  function observeFrame(img, frame) {
    if (!window.ResizeObserver || resizeObservers.has(img) || !frame) return;
    const observer = new ResizeObserver(() => apply(img));
    observer.observe(frame);
    resizeObservers.set(img, observer);
  }

  function apply(img, options = {}) {
    if (!(img instanceof HTMLImageElement)) return;
    const frame = options.frame || img.parentElement;
    if (!(frame instanceof HTMLElement)) return;

    const values = valuesFor(img, options);
    img.dataset.portraitX = String(values.x);
    img.dataset.portraitY = String(values.y);
    img.dataset.portraitZoom = String(values.zoom);

    if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
      setFallback(img);
      if (!img.dataset.portraitLoadBound) {
        img.dataset.portraitLoadBound = 'true';
        img.addEventListener('load', () => {
          delete img.dataset.portraitLoadBound;
          apply(img);
        }, { once: true });
      }
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const frameWidth = Math.max(1, frameRect.width || frame.clientWidth || 1);
    const frameHeight = Math.max(1, frameRect.height || frame.clientHeight || 1);
    const coverScale = Math.max(
      frameWidth / img.naturalWidth,
      frameHeight / img.naturalHeight
    );
    const zoomScale = values.zoom / 100;
    const drawWidth = img.naturalWidth * coverScale * zoomScale;
    const drawHeight = img.naturalHeight * coverScale * zoomScale;

    // Panning is limited to the part of the scaled image that extends beyond
    // the circular frame. This means dragging can never expose an image edge
    // and create the straight-line "head cut off" artifact.
    const maxShiftX = Math.max(0, (drawWidth - frameWidth) / 2);
    const maxShiftY = Math.max(0, (drawHeight - frameHeight) / 2);
    const shiftX = ((values.x - 50) / 50) * maxShiftX;
    const shiftY = ((values.y - 50) / 50) * maxShiftY;
    const left = (frameWidth - drawWidth) / 2 + shiftX;
    const top = (frameHeight - drawHeight) / 2 + shiftY;

    const important = (name, value) => img.style.setProperty(name, value, 'important');
    important('position', 'absolute');
    important('inset', 'auto');
    important('left', left + 'px');
    important('top', top + 'px');
    important('right', 'auto');
    important('bottom', 'auto');
    important('width', drawWidth + 'px');
    important('height', drawHeight + 'px');
    important('max-width', 'none');
    important('object-fit', 'fill');
    important('object-position', '50% 50%');
    important('transform', 'none');
    important('transform-origin', '50% 50%');

    observeFrame(img, frame);
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
      [section.querySelector('.fc-left .fc-portrait img'), config.a],
      [section.querySelector('.fc-right .fc-portrait img'), config.b]
    ];
    for (const [img, fighter] of pairs) {
      if (!img || !fighter) continue;
      apply(img, {
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

  window.MatlockPortraitCrop = { apply, hydrate };

  hydrate();

  let timer = 0;
  const observer = new MutationObserver(mutations => {
    const roots = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) roots.push(node);
      }
    }
    if (!roots.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => roots.forEach(hydrate), 20);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
