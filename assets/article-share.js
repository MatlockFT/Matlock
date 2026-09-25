(() => {
  const section = document.querySelector('[data-post-share]');
  if (!section || section.dataset.shareReady === '1') return;
  section.dataset.shareReady = '1';

  const shareUrl = section.dataset.shareUrl || location.href;
  const shareTitle = section.dataset.shareTitle || document.title;
  const shareText = section.dataset.shareText || shareTitle;
  const shareImage = section.dataset.shareImage || '';
  const featured = document.querySelector('.post-featured-image img');

  const nativeButton = section.querySelector('[data-native-share]');
  const copyButton = section.querySelector('[data-copy-link]');
  const xButton = section.querySelector('[data-share-x]');
  const threadsButton = section.querySelector('[data-share-threads]');
  const facebookButton = section.querySelector('[data-share-facebook]');
  const redditButton = section.querySelector('[data-share-reddit]');
  const instagramButtons = [...section.querySelectorAll('[data-share-instagram]')];
  const status = section.querySelector('[data-share-status]');
  let statusTimer = 0;

  const touchLike =
    window.matchMedia?.('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  const setStatus = (message, timeout = 3600) => {
    if (!status) return;
    clearTimeout(statusTimer);
    status.textContent = message || '';
    if (message && timeout) {
      statusTimer = window.setTimeout(() => {
        status.textContent = '';
      }, timeout);
    }
  };

  const shareThroughDevice = async (platform, payload = {}) => {
    if (!navigator.share) return false;

    const data = {
      title: payload.title || shareTitle,
      text: payload.text || shareText,
      url: payload.url || shareUrl
    };

    try {
      await navigator.share(data);
      setStatus('Choose ' + platform + ' from the share sheet.');
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return true;
      return false;
    }
  };

  const popup = (url, name = 'mmaMatlockShare') => {
    const child = window.open(
      url,
      name,
      'popup=yes,width=760,height=720,resizable=yes,scrollbars=yes'
    );
    if (child) {
      try { child.opener = null; } catch {}
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const copyText = async (value) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const field = document.createElement('textarea');
    field.value = value;
    field.readOnly = true;
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    if (!ok) throw new Error('Copy failed');
  };

  const flashCopy = async () => {
    try {
      await copyText(shareUrl);
      const old = copyButton?.textContent || 'Copy';
      if (copyButton) {
        copyButton.textContent = 'Copied';
        copyButton.disabled = true;
        setTimeout(() => {
          copyButton.textContent = old;
          copyButton.disabled = false;
        }, 1500);
      }
      setStatus('Article link copied.');
    } catch {
      setStatus('Could not copy the article link.');
    }
  };

  if (nativeButton && navigator.share) {
    nativeButton.hidden = false;
    nativeButton.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
      } catch (error) {
        if (error?.name !== 'AbortError') {
          setStatus('The share menu could not be opened.');
        }
      }
    });
  }

  xButton?.addEventListener('click', async () => {
    if (touchLike && await shareThroughDevice('X', {
      text: shareTitle,
      url: shareUrl
    })) return;

    popup(
      'https://twitter.com/intent/tweet?text=' +
      encodeURIComponent(shareTitle) +
      '&url=' +
      encodeURIComponent(shareUrl),
      'mmaMatlockXShare'
    );
  });

  threadsButton?.addEventListener('click', async () => {
    const text = shareTitle + '\n\n' + shareUrl;

    if (touchLike && await shareThroughDevice('Threads', {
      text,
      url: shareUrl
    })) return;

    popup(
      'https://www.threads.net/intent/post?text=' + encodeURIComponent(text),
      'mmaMatlockThreadsShare'
    );
  });

  facebookButton?.addEventListener('click', async () => {
    if (touchLike && await shareThroughDevice('Facebook', {
      text: shareTitle,
      url: shareUrl
    })) return;

    const target =
      'https://www.facebook.com/sharer/sharer.php?display=popup&u=' +
      encodeURIComponent(shareUrl);
    popup(target, 'mmaMatlockFacebookShare');
  });

  redditButton?.addEventListener('click', async () => {
    if (touchLike && await shareThroughDevice('Reddit', {
      text: shareTitle,
      url: shareUrl
    })) return;

    popup(
      'https://www.reddit.com/submit?url=' +
      encodeURIComponent(shareUrl) +
      '&title=' +
      encodeURIComponent(shareTitle),
      'mmaMatlockRedditShare'
    );
  });

  copyButton?.addEventListener('click', flashCopy);

  const loadShareImage = async () => {
    const source = shareImage || featured?.currentSrc || featured?.src || '';
    if (!source) return null;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });

    image.src = source;
    try {
      await loaded;
      return image;
    } catch {
      return null;
    }
  };

  const coverImage = (ctx, image, x, y, width, height, position = '50% 50%') => {
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    if (!naturalW || !naturalH) return;

    const scale = Math.max(width / naturalW, height / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;

    const parts = String(position || '50% 50%').split(/\s+/);
    const parsePercent = (value, fallback) => {
      const match = String(value || '').match(/(-?\d+(?:\.\d+)?)%/);
      return match ? Number(match[1]) / 100 : fallback;
    };
    const px = parsePercent(parts[0], .5);
    const py = parsePercent(parts[1], .5);
    const dx = x - Math.max(0, drawW - width) * px;
    const dy = y - Math.max(0, drawH - height) * py;
    ctx.drawImage(image, dx, dy, drawW, drawH);
  };

  const splitTitle = (ctx, title, maxWidth, maxLines) => {
    const words = String(title || '').trim().split(/\s+/);
    const lines = [];
    let line = '';

    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (!line || ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }

    if (line && lines.length < maxLines) lines.push(line);

    const usedWords = lines.join(' ').split(/\s+/).length;
    if (usedWords < words.length && lines.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last.trim() + '…';
    }

    return lines;
  };

  const canvasBlob = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Card render failed')),
      'image/png'
    );
  });

  const renderInstagramCard = async (format) => {
    const story = format === 'story';
    const width = 1080;
    const height = story ? 1920 : 1350;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas unavailable');

    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch {}
    }

    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    const image = await loadShareImage();
    const artHeight = Math.round(height * (story ? .57 : .58));

    if (image) {
      const objectPosition = featured
        ? getComputedStyle(featured).objectPosition
        : '50% 50%';
      coverImage(ctx, image, 0, 0, width, artHeight, objectPosition);

      const gradient = ctx.createLinearGradient(0, 0, 0, artHeight);
      gradient.addColorStop(0, 'rgba(0,0,0,.08)');
      gradient.addColorStop(.62, 'rgba(0,0,0,.18)');
      gradient.addColorStop(1, 'rgba(8,8,8,1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, artHeight);
    } else {
      const glow = ctx.createRadialGradient(
        width * .5, artHeight * .38, 20,
        width * .5, artHeight * .38, width * .7
      );
      glow.addColorStop(0, 'rgba(255,72,84,.22)');
      glow.addColorStop(1, 'rgba(255,72,84,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, artHeight);
    }

    const pad = story ? 84 : 72;
    const copyTop = artHeight - (story ? 36 : 28);

    ctx.fillStyle = '#ff4a54';
    ctx.fillRect(pad, copyTop, 86, 8);

    ctx.fillStyle = '#f5f1e8';
    ctx.font = '900 34px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('MMA MATLOCK', pad, copyTop + 34);

    ctx.fillStyle = '#aaa69f';
    ctx.font = '800 22px Arial, Helvetica, sans-serif';
    ctx.fillText('BREAKDOWN', pad, copyTop + 84);

    let fontSize = story ? 76 : 68;
    let lines = [];
    do {
      ctx.font = '700 ' + fontSize + 'px Georgia, "Times New Roman", serif';
      lines = splitTitle(ctx, shareTitle.replace(/\s*\|\s*MMA Matlock$/i, ''), width - pad * 2, story ? 7 : 5);
      fontSize -= 2;
    } while (
      fontSize > 48 &&
      lines.length * (fontSize + 12) > height - copyTop - (story ? 300 : 235)
    );
    fontSize += 2;

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + fontSize + 'px Georgia, "Times New Roman", serif';
    const lineHeight = Math.round(fontSize * 1.06);
    let y = copyTop + 132;
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += lineHeight;
    }

    ctx.fillStyle = '#8e8a84';
    ctx.font = '800 22px Arial, Helvetica, sans-serif';
    ctx.fillText('MMAMATLOCK.COM', pad, height - (story ? 120 : 92));

    return canvasBlob(canvas);
  };

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const instagramShare = async (button, format) => {
    if (button.classList.contains('is-working')) return;
    button.classList.add('is-working');
    const old = button.textContent;
    button.textContent = 'Preparing';
    setStatus('Building the ' + (format === 'story' ? '9:16 Story' : '4:5 Post') + ' card…', 0);

    try {
      const blob = await renderInstagramCard(format);
      const fileName =
        'mma-matlock-' +
        (format === 'story' ? 'story' : 'post') +
        '.png';
      const file = new File([blob], fileName, { type: 'image/png' });
      const caption = shareTitle.replace(/\s*\|\s*MMA Matlock$/i, '') + '\n\n' + shareUrl;
      const payload = { files: [file], title: shareTitle, text: caption };

      const canShareFiles =
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      if (canShareFiles) {
        try {
          await navigator.share(payload);
          setStatus('Share card ready. Choose Instagram, then Post or Story.');
          return;
        } catch (error) {
          if (error?.name === 'AbortError') {
            setStatus('');
            return;
          }
        }
      }

      downloadBlob(blob, fileName);
      try { await copyText(caption); } catch {}
      setStatus('Card saved and caption copied. Open Instagram to post it.', 6000);
    } catch (error) {
      console.warn('Instagram share card failed', error);
      try {
        if (navigator.share) {
          await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
          setStatus('Opened the standard share menu.');
        } else {
          await copyText(shareUrl);
          setStatus('Could not build the card; article link copied.');
        }
      } catch (shareError) {
        if (shareError?.name !== 'AbortError') {
          setStatus('Instagram share could not be prepared.');
        }
      }
    } finally {
      button.classList.remove('is-working');
      button.textContent = old;
    }
  };

  if (touchLike && navigator.share) {
    [
      [xButton, 'Share via X'],
      [threadsButton, 'Share via Threads'],
      [facebookButton, 'Share via Facebook'],
      [redditButton, 'Share via Reddit']
    ].forEach(([button, label]) => {
      if (!button) return;
      button.title = label + ' using your phone share sheet';
    });
  }

  instagramButtons.forEach(button => {
    button.addEventListener('click', () => {
      instagramShare(button, button.dataset.shareInstagram || 'post');
    });
  });
})();
