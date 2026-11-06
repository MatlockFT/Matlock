/* Subtle autumn leaf physics for the public site. No dependencies or network requests. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const footer = document.querySelector('.site-footer');
  if (!footer || reduceMotion.matches || navigator.connection?.saveData) return;

  const STRENGTH = 0.55;
  const mobile = window.matchMedia('(max-width: 700px)');
  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const canvas = document.createElement('canvas');
  canvas.className = 'autumn-leaf-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.remove(); return; }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let lastFrame = 0;
  let nextLeafAt = 0;
  let scrollY = window.scrollY;
  let scrollGust = 0;
  let stopped = false;
  const leaves = [];
  const settled = [];

  // Each sprite is pre-rendered once; the animation only draws cached bitmaps.
  function makeSprite(kind) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 128;
    const c = sprite.getContext('2d');
    c.translate(64, 64);
    c.scale(1.35, 1.35);
    const palette = [
      ['#b67a3c', '#613c20', '#db9d51'],
      ['#9b5430', '#4b3024', '#ca7847'],
      ['#a18449', '#4b4025', '#c5a35d'],
      ['#8c643c', '#4f3627', '#bf8550']
    ][kind];
    const shape = new Path2D();
    if (kind === 0) { // dry maple, with broken angular lobes
      shape.moveTo(0, -38); shape.lineTo(7, -19); shape.lineTo(19, -28);
      shape.lineTo(21, -14); shape.lineTo(39, -17); shape.lineTo(29, -4);
      shape.lineTo(40, 8); shape.lineTo(22, 10); shape.lineTo(17, 25);
      shape.lineTo(6, 19); shape.lineTo(0, 38); shape.lineTo(-6, 19);
      shape.lineTo(-19, 26); shape.lineTo(-22, 10); shape.lineTo(-40, 8);
      shape.lineTo(-29, -4); shape.lineTo(-39, -17); shape.lineTo(-21, -14);
      shape.lineTo(-19, -28); shape.lineTo(-7, -19);
    } else if (kind === 1) { // lobed oak
      shape.moveTo(0, -38);
      shape.bezierCurveTo(15, -42, 20, -29, 15, -21);
      shape.bezierCurveTo(34, -30, 40, -10, 24, -3);
      shape.bezierCurveTo(38, 5, 34, 20, 17, 18);
      shape.bezierCurveTo(25, 32, 10, 38, 0, 31);
      shape.bezierCurveTo(-10, 38, -25, 32, -17, 18);
      shape.bezierCurveTo(-34, 20, -38, 5, -24, -3);
      shape.bezierCurveTo(-40, -10, -34, -30, -15, -21);
      shape.bezierCurveTo(-20, -29, -15, -42, 0, -38);
    } else if (kind === 2) { // pointed, curled elm
      shape.moveTo(-2, -39);
      shape.bezierCurveTo(15, -32, 33, -17, 27, -3);
      shape.lineTo(23, 1); shape.lineTo(28, 5); shape.lineTo(20, 10);
      shape.lineTo(24, 15); shape.lineTo(13, 20); shape.lineTo(15, 24);
      shape.bezierCurveTo(4, 32, -4, 35, -8, 39);
      shape.bezierCurveTo(-23, 25, -35, 12, -27, -4);
      shape.lineTo(-23, -7); shape.lineTo(-28, -12); shape.lineTo(-18, -17);
      shape.lineTo(-22, -23);
      shape.bezierCurveTo(-13, -29, -8, -35, -2, -39);
    } else { // small shriveled brown leaf
      shape.moveTo(0, -38);
      shape.bezierCurveTo(16, -30, 22, -20, 22, -10);
      shape.bezierCurveTo(37, 7, 19, 22, 3, 36);
      shape.bezierCurveTo(-17, 27, -33, 12, -25, -5);
      shape.bezierCurveTo(-21, -18, -11, -33, 0, -38);
    }
    shape.closePath();
    const fill = c.createLinearGradient(-30, -35, 34, 35);
    fill.addColorStop(0, palette[2]);
    fill.addColorStop(0.43, palette[0]);
    fill.addColorStop(1, palette[1]);
    c.fillStyle = fill;
    c.strokeStyle = '#3d3025';
    c.lineWidth = 1.5;
    c.fill(shape);
    c.stroke(shape);
    c.save();
    c.clip(shape);
    // Dry, uneven patches and faint leaf texture, clipped to the silhouette.
    let seed = 3451 + kind * 913;
    const seeded = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 125; i++) {
      const x = (seeded() - 0.5) * 76;
      const y = (seeded() - 0.5) * 80;
      const r = 0.4 + seeded() * 2.9;
      c.globalAlpha = 0.045 + seeded() * 0.13;
      c.fillStyle = seeded() > 0.52 ? '#f3c777' : '#2d251f';
      c.beginPath(); c.ellipse(x, y, r, r * random(0.45, 1.1), seeded() * 5, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 0.62;
    c.strokeStyle = '#513821';
    c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(0, 36); c.quadraticCurveTo(2, 4, 0, -34); c.stroke();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const y = -22 + i * 13;
        c.beginPath(); c.moveTo(0, y + 6);
        c.quadraticCurveTo(side * 12, y - 3, side * (14 + (i % 2) * 9), y - 11);
        c.stroke();
      }
    }
    c.restore();
    c.strokeStyle = '#6a4a2e';
    c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(0, 31); c.lineTo(2, 44); c.stroke();
    return sprite;
  }
  const sprites = Array.from({ length: 4 }, (_, i) => makeSprite(i));

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, mobile.matches ? 1.25 : 1.5);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeLeaf() {
    const size = random(mobile.matches ? 19 : 24, mobile.matches ? 33 : 45);
    return {
      x: random(12, width - 12), y: -size,
      vx: random(-15, 15), vy: random(17, 32),
      angle: random(-Math.PI, Math.PI), spin: random(-1, 1),
      phase: random(0, Math.PI * 2), sway: random(0.8, 1.6),
      gravity: random(53, 88), size, kind: Math.floor(random(0, 4)),
      opacity: random(0.55, 0.82), flutter: random(1.3, 2.8)
    };
  }

  function addSettled(x) {
    const limit = mobile.matches ? 9 : 18;
    if (settled.length >= limit) return;
    const edge = Math.random() < 0.5;
    const normalizedX = typeof x === 'number' && (x < width * 0.23 || x > width * 0.77)
      ? x / width : (edge ? random(0.025, 0.18) : random(0.82, 0.975));
    settled.push({
      x: normalizedX, offset: random(4, 19),
      angle: random(-Math.PI, Math.PI),
      kind: Math.floor(random(0, 4)), size: random(19, mobile.matches ? 32 : 42),
      opacity: random(0.58, 0.79)
    });
  }

  function drawLeaf(leaf, x, y, angle, opacity) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = opacity;
    // A slight perspective squash simulates the leaf rolling edge-on in air.
    const squash = leaf.phase === undefined ? 0.72 : 0.55 + Math.abs(Math.cos(leaf.phase)) * 0.45;
    ctx.scale(squash, 1);
    ctx.drawImage(sprites[leaf.kind], -leaf.size / 2, -leaf.size / 2, leaf.size, leaf.size);
    ctx.restore();
  }

  function paint(floor) {
    ctx.clearRect(0, 0, width, height);
    // The pile is attached to the real document footer, not the viewport.
    if (floor > -25 && floor < height + 28) {
      for (const leaf of settled) {
        drawLeaf(leaf, leaf.x * width, floor - leaf.offset, leaf.angle, leaf.opacity);
      }
    }
    for (const leaf of leaves) drawLeaf(leaf, leaf.x, leaf.y, leaf.angle, leaf.opacity);
  }

  function tick(now) {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    const interval = mobile.matches ? 1000 / 24 : 1000 / 30;
    if (now - lastFrame < interval) return;
    const dt = clamp((now - (lastFrame || now - interval)) / 1000, 0.008, 0.06);
    lastFrame = now;
    scrollGust *= Math.exp(-2.25 * dt);

    if (now > nextLeafAt && leaves.length < (mobile.matches ? 3 : 5)) {
      leaves.push(makeLeaf());
      nextLeafAt = now + random(mobile.matches ? 16000 : 10000, mobile.matches ? 26000 : 20000);
    }
    const floor = footer.getBoundingClientRect().bottom;
    for (let i = leaves.length - 1; i >= 0; i--) {
      const leaf = leaves[i];
      leaf.phase += dt * leaf.flutter;
      leaf.vy = clamp(leaf.vy + (leaf.gravity - scrollGust * STRENGTH) * dt, -105, 85);
      leaf.vx = clamp(leaf.vx + Math.sin(leaf.phase) * leaf.sway * dt * 14, -35, 35);
      leaf.vx *= Math.exp(-0.32 * dt);
      leaf.x += leaf.vx * dt;
      leaf.y += leaf.vy * dt;
      leaf.angle += (leaf.spin + Math.sin(leaf.phase) * 0.55) * dt;
      const landedOnFooter = floor > 0 && floor < height + 20 && leaf.y >= floor - 12 && leaf.vy > 0;
      if (landedOnFooter || leaf.y > height + 48 || leaf.x < -55 || leaf.x > width + 55) {
        addSettled(landedOnFooter ? leaf.x : undefined);
        leaves.splice(i, 1);
      }
    }
    paint(floor);
  }

  function onScroll() {
    const delta = window.scrollY - scrollY;
    scrollY = window.scrollY;
    if (!delta) return;
    // Downward scroll suspends the fall; upward scroll catches/lifts leaves.
    const lift = delta > 0 ? Math.min(delta * 2.2, 220) : Math.min(-delta * 3.4, 410);
    scrollGust = clamp(scrollGust + lift, 0, delta > 0 ? 290 : 460);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  }

  function resume() {
    if (stopped || document.hidden || reduceMotion.matches || frame) return;
    lastFrame = 0;
    frame = requestAnimationFrame(tick);
  }

  function onMotionChange() {
    if (reduceMotion.matches) {
      stopped = true;
      pause();
      canvas.remove();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
    }
  }

  resize();
  for (let i = 0; i < (mobile.matches ? 2 : 4); i++) addSettled();
  nextLeafAt = performance.now() + random(800, 2400);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
  reduceMotion.addEventListener?.('change', onMotionChange);
  resume();
})();