(() => {
  const root = document.querySelector('[data-mfc-root]');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const useDraft = params.get('mode') === 'draft' || params.get('preview') === 'draft';
  const monitorMode = params.get('monitor') === '1';
  if (params.get('embed') === '1') document.body.dataset.mfcEmbed = 'true';
  if (monitorMode) document.body.dataset.mfcMonitor = 'true';

  const screen = root.querySelector('[data-mfc-screen]');
  const header = root.querySelector('[data-mfc-header]');
  const eyebrow = root.querySelector('[data-mfc-eyebrow]');
  const title = root.querySelector('[data-mfc-title]');
  const bodyCopy = root.querySelector('[data-mfc-body]');
  const copy = root.querySelector('[data-mfc-copy]');
  const copyPage = root.querySelector('[data-mfc-copy-page]');
  let copyLayout = null;
  let fitFrame = 0;
  const image = root.querySelector('[data-mfc-image]');
  const video = root.querySelector('[data-mfc-video]');
  const panel = root.querySelector('[data-mfc-panel]');
  const youtubeHost = root.querySelector('[data-mfc-youtube]');
  const dateNode = root.querySelector('[data-mfc-date]');
  const clockNode = root.querySelector('[data-mfc-clock]');
  const nowNode = root.querySelector('[data-mfc-now]');
  const progressNode = root.querySelector('[data-mfc-progress]');
  const ticker = root.querySelector('[data-mfc-ticker]');
  const tickerClone = root.querySelector('[data-mfc-ticker-clone]');
  const tickerTrack = root.querySelector('[data-mfc-ticker-track]');
  const soundButton = root.querySelector('[data-mfc-sound]');
  const musicA = document.querySelector('[data-mfc-music-a]');
  const musicB = document.querySelector('[data-mfc-music-b]');
  const STATE_URLS = [
    'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/broadcast.json',
    '/assets/uploads/broadcast.json',
    'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/data/broadcast.json',
    '/assets/data/broadcast.json'
  ];
  const SOUND_KEY = 'matlock-fight-channel:sound';

  let state = null;
  let channel = null;
  let revision = '';
  let currentProgramId = '';
  let currentMusicId = '';
  let lastTickAt = performance.now();
  let musicLevel = 0;
  let soundEnabled = false;
  let activeMusic = musicA;
  let standbyMusic = musicB;
  let lastPoll = 0;
  let previewOverride = false;
  const failedMedia = new Map();
  const pendingPlay = new WeakSet();
  const waitingSince = new WeakMap();
  let soundBlocked = false;
  const playbackStatus = root.querySelector('[data-mfc-playback-status]');
  const youtube = youtubeHost && window.matlockYoutubePlayer?.(youtubeHost, {
    error: url => {
      failedMedia.set(url, Date.now() + 60000); currentProgramId = '';
      reportPlayback('A YouTube video is unavailable. Continuing with available content; retrying in one minute.');
    },
    blocked: () => {
      soundBlocked = true; setSoundState(false); soundButton.hidden = false;
      soundButton.textContent = 'CLICK TO ENABLE SOUND';
      reportPlayback('YouTube autoplay was blocked. Click Sound On or the video play button.', true);
    },
    playing: () => { if (!soundBlocked) reportPlayback(''); }
  });

  function reportPlayback(message, blocked = false) {
    if (playbackStatus) { playbackStatus.textContent = message; playbackStatus.hidden = !message; }
    if (monitorMode && window.parent !== window) window.parent.postMessage({ type: 'matlock-broadcast-playback-status', message, soundEnabled, blocked }, location.origin);
  }

  function sourceAvailable(url) {
    return Boolean(url) && !(failedMedia.get(url) > Date.now());
  }

  function failMedia(element) {
    const url = element.dataset.source || element.dataset.mediaUrl;
    if (!url || failedMedia.get(url) > Date.now()) return;
    failedMedia.set(url, Date.now() + 60000);
    waitingSince.delete(element);
    element.pause();
    reportPlayback('A file could not play. Continuing with available content; retrying in one minute.');
    currentProgramId = '';
    currentMusicId = '';
  }

  function safePlay(element) {
    if (!element.paused || pendingPlay.has(element)) return;
    const source = element.src;
    pendingPlay.add(element);
    element.play().catch(error => {
      if (element.src !== source) return;
      if (error.name === 'NotAllowedError') {
        soundBlocked = true;
        setSoundState(false);
        soundButton.hidden = false;
        soundButton.textContent = 'CLICK TO ENABLE SOUND';
        reportPlayback('Click Sound On in this player to enable audio.', true);
      } else if (error.name !== 'AbortError') failMedia(element);
    }).finally(() => pendingPlay.delete(element));
  }

  for (const element of [video, musicA, musicB]) {
    element.addEventListener('error', () => failMedia(element));
    element.addEventListener('waiting', () => { if (!waitingSince.has(element)) waitingSince.set(element, Date.now()); });
    element.addEventListener('playing', () => { waitingSince.delete(element); if (!soundBlocked) reportPlayback(''); });
  }
  image.addEventListener('error', () => {
    if (image.dataset.source) failedMedia.set(image.dataset.source, Date.now() + 60000);
    currentProgramId = '';
    reportPlayback('An image could not load. Continuing the loop.');
  });

  try { soundEnabled = localStorage.getItem(SOUND_KEY) === 'on'; } catch {}
  if (monitorMode) soundEnabled = false;
  if (monitorMode && soundButton) soundButton.hidden = true;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const positive = value => Math.max(0, Number(value) || 0);
  const mod = (value, size) => size > 0 ? ((value % size) + size) % size : 0;

  function youtubeVideoId(value) {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
      if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        if (url.pathname === '/watch') return url.searchParams.get('v') || '';
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/);
        return match?.[1] || '';
      }
    } catch {}
    return '';
  }

  function setSlotVolume(element, value) { element.volume = clamp(value, 0, 1); }
  function playSlot(element) { safePlay(element); }
  function pauseSlot(element) { element.pause(); waitingSince.delete(element); }

  function fmt(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(value / 60);
    const s = value % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function programItems() {
    return Array.isArray(channel?.program) ? channel.program.filter(item => positive(item.duration) > 0
      && (item.type !== 'youtube' || (youtube && /^[A-Za-z0-9_-]{11}$/.test(item.youtubeId || '')
        && item.mediaUrl === 'https://www.youtube.com/watch?v=' + item.youtubeId && positive(item.sourceDuration) > 180 && positive(item.duration) <= positive(item.sourceDuration)))
      && (!['video', 'image', 'youtube'].includes(item.type) || sourceAvailable(item.mediaUrl))) : [];
  }

  function musicItems() {
    return Array.isArray(channel?.music) ? channel.music.filter(item => sourceAvailable(item?.url) && !youtubeVideoId(item.url) && !item.youtubeId && positive(item.duration) > 0) : [];
  }

  function timelinePosition(items, elapsed) {
    const total = items.reduce((sum, item) => sum + positive(item.duration), 0);
    if (!items.length || total <= 0) return { item: null, index: -1, local: 0, total, position: 0 };
    const position = mod(elapsed, total);
    let cursor = 0;
    for (let index = 0; index < items.length; index += 1) {
      const duration = positive(items[index].duration);
      if (position < cursor + duration || index === items.length - 1) {
        return { item: items[index], index, local: Math.max(0, position - cursor), total, position };
      }
      cursor += duration;
    }
    return { item: items[0], index: 0, local: 0, total, position: 0 };
  }

  function rawElapsed() {
    if (!channel) return 0;
    const stamp = Date.parse(channel.startedAt || channel.updatedAt || '');
    if (!Number.isFinite(stamp)) return 0;
    return Math.max(0, (Date.now() - stamp) / 1000);
  }

  function textForTicker() {
    const entries = Array.isArray(channel?.ticker)
      ? channel.ticker.map(value => String(value || '').trim()).filter(Boolean)
      : String(channel?.ticker || '').split('|').map(value => value.trim()).filter(Boolean);
    return (entries.length ? entries : ['MATLOCK FIGHT CHANNEL', 'MMA NEWS', 'RESULTS', 'BREAKDOWNS']).join('   •   ');
  }

  function renderTicker() {
    const text = textForTicker();
    ticker.textContent = text;
    tickerClone.textContent = text;
    const seconds = clamp(text.length * .16, 24, 110);
    tickerTrack.style.setProperty('--mfc-ticker-seconds', `${seconds}s`);
  }

  function setMediaMode(kind) {
    const isVideo = kind === 'video';
    const isImage = kind === 'image';
    const isYoutube = kind === 'youtube';
    youtubeHost.hidden = !isYoutube;
    if (!isYoutube) youtube?.stop();
    screen.classList.remove('is-compact-youtube');
    if (isYoutube) {
      const bounds = panel.getBoundingClientRect();
      screen.classList.toggle('is-compact-youtube', bounds.width < 200 || bounds.height < 200);
    }
    panel.classList.toggle('has-youtube', isYoutube);
    video.hidden = !isVideo;
    image.hidden = !isImage;
    panel.classList.toggle('has-media', isVideo || isImage || isYoutube);
    eyebrow.hidden = isVideo || isImage || isYoutube;
    title.hidden = isVideo || isImage || isYoutube;
    bodyCopy.hidden = isVideo || isImage || isYoutube;
    copy.hidden = isVideo || isImage || isYoutube;
  }

  function largestFit(minimum, maximum, apply, fits) {
    apply(maximum);
    if (fits()) return maximum;
    let low = minimum, high = maximum;
    for (let step = 0; step < 10; step++) {
      const middle = (low + high) / 2; apply(middle);
      if (fits()) low = middle; else high = middle;
    }
    apply(low); return low;
  }

  function showCopyPage(position) {
    if (!copyLayout || copyLayout.key !== currentProgramId || copy.hidden) return;
    const index = Math.min(copyLayout.pages.length - 1, Math.floor(position.local / Math.max(1, positive(position.item?.duration)) * copyLayout.pages.length));
    if (index === copyLayout.index) return;
    copyLayout.index = index; bodyCopy.textContent = copyLayout.pages[index];
    copyPage.textContent = 'PAGE ' + (index + 1) + ' / ' + copyLayout.pages.length;
  }

  function fitBroadcastCopy() {
    if (!panel.clientWidth || !panel.clientHeight) return;
    header.style.fontSize = '';
    const headerBox = header.parentElement, headerStyle = getComputedStyle(headerBox);
    const headerHeight = headerBox.clientHeight - parseFloat(headerStyle.paddingTop) - parseFloat(headerStyle.paddingBottom);
    const headerWidth = headerBox.clientWidth - parseFloat(headerStyle.paddingLeft) - parseFloat(headerStyle.paddingRight);
    largestFit(1, parseFloat(getComputedStyle(header).fontSize), size => { header.style.fontSize = size + 'px'; },
      () => header.scrollWidth <= headerWidth + .5 && header.getBoundingClientRect().height <= headerHeight + .5);
    if (copy.hidden || !copy.clientHeight) { copyLayout = null; return; }
    title.style.fontSize = ''; eyebrow.style.fontSize = ''; bodyCopy.style.fontSize = '';
    copyPage.hidden = true;
    const item = timelinePosition(programItems(), rawElapsed()).item;
    const fullBody = item ? String(item.body || '') : bodyCopy.textContent;
    bodyCopy.textContent = fullBody;
    const titleSize = parseFloat(getComputedStyle(title).fontSize), eyebrowSize = parseFloat(getComputedStyle(eyebrow).fontSize);
    largestFit(.05, 1, scale => {
      title.style.fontSize = titleSize * scale + 'px'; eyebrow.style.fontSize = eyebrowSize * scale + 'px';
    }, () => {
      const titleHeight = title.getBoundingClientRect().height, eyebrowHeight = eyebrow.getBoundingClientRect().height;
      return titleHeight + eyebrowHeight <= copy.clientHeight * (fullBody ? .42 : .88)
        && title.scrollWidth <= title.clientWidth + 1 && eyebrow.scrollWidth <= eyebrow.clientWidth + 1;
    });
    const baseBodySize = parseFloat(getComputedStyle(bodyCopy).fontSize);
    const minimumBodySize = Math.min(baseBodySize, Math.max(9, Math.min(16, screen.clientWidth * .029)));
    largestFit(minimumBodySize, baseBodySize, size => { bodyCopy.style.fontSize = size + 'px'; },
      () => bodyCopy.scrollHeight <= bodyCopy.clientHeight + 1 && bodyCopy.scrollWidth <= bodyCopy.clientWidth + 1);
    const pages = [];
    if (bodyCopy.scrollHeight <= bodyCopy.clientHeight + 1 && bodyCopy.scrollWidth <= bodyCopy.clientWidth + 1) pages.push(fullBody);
    else {
      copyPage.hidden = false; copyPage.textContent = 'PAGE 1 / 2';
      let remaining = fullBody;
      while (remaining.length) {
        let low = 0, high = remaining.length;
        // Measure actual rendered lines, including paragraphs and unbroken URLs.
        while (low < high) {
          const middle = Math.ceil((low + high) / 2); bodyCopy.textContent = remaining.slice(0, middle);
          if (bodyCopy.scrollHeight <= bodyCopy.clientHeight + 1 && bodyCopy.scrollWidth <= bodyCopy.clientWidth + 1) low = middle;
          else high = middle - 1;
        }
        let end = Math.max(1, low);
        if (end < remaining.length) {
          const boundary = remaining.slice(0, end).search(/\s+\S*$/);
          if (boundary > end * .5) end = boundary + 1;
          // Never split a surrogate pair (emoji) across pages.
          if (end > 1 && /[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end])) end--;
        }
        pages.push(remaining.slice(0, end)); remaining = remaining.slice(end);
      }
    }
    copyLayout = { key: currentProgramId, pages, index: -1 };
    copyPage.hidden = pages.length < 2;
    showCopyPage(timelinePosition(programItems(), rawElapsed()));
    if (monitorMode && window.parent !== window && item) {
      window.parent.postMessage({ type: 'matlock-broadcast-layout', itemId: item.id, pages: pages.length,
        signature: JSON.stringify([item.type, item.title || '', item.eyebrow || '', item.header || '', item.body || '']),
        characters: fullBody.length, secondsPerPage: positive(item.duration) / pages.length,
        suggestedDuration: Math.max(pages.length * 8, Math.ceil(fullBody.split(/\s+/).filter(Boolean).length / 2)),
        smallHeading: parseFloat(getComputedStyle(title).fontSize) < Math.max(9, screen.clientWidth * .018)
      }, location.origin);
    }
  }

  function scheduleCopyFit() {
    if (fitFrame) return;
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitBroadcastCopy(); });
  }
  window.addEventListener('resize', () => { setMediaMode(timelinePosition(programItems(), rawElapsed()).item?.type || 'headline'); scheduleCopyFit(); });
  new ResizeObserver(scheduleCopyFit).observe(panel);
  document.fonts?.ready.then(scheduleCopyFit);
  document.fonts?.addEventListener('loadingdone', scheduleCopyFit);

  function renderProgramItem(item) {
    if (!item) {
      setMediaMode('headline');
      screen.dataset.kind = 'headline';
      header.textContent = 'YOUR FIGHT FORECAST';
      eyebrow.textContent = 'MATLOCK FIGHT CHANNEL';
      title.textContent = 'NO PROGRAMMING';
      bodyCopy.textContent = 'Add items in the broadcast control room.';
      nowNode.textContent = 'NOW: STANDBY';
      copyLayout = null; scheduleCopyFit();
      return;
    }

    const kind = String(item.type || 'headline').toLowerCase();
    screen.dataset.kind = kind;
    setMediaMode(kind);
    header.textContent = String(item.header || item.section || ({
      headline: 'YOUR FIGHT FORECAST',
      results: 'FIGHT RESULTS',
      event: 'UPCOMING FIGHTS',
      breaking: 'BREAKING NEWS',
      image: 'MMA NEWS',
      video: 'MMA VIDEO'
    }[kind] || 'MMA NEWS')).toUpperCase();

    eyebrow.textContent = String(item.eyebrow || ({
      headline: 'LATEST',
      results: 'RESULTS',
      event: 'NEXT EVENT',
      breaking: 'BREAKING',
      image: 'PHOTO',
      video: 'VIDEO'
    }[kind] || 'MATLOCK FIGHT CHANNEL')).toUpperCase();

    title.textContent = String(item.title || 'MATLOCK FIGHT CHANNEL').toUpperCase();
    bodyCopy.textContent = String(item.body || '');
    nowNode.textContent = `NOW: ${String(item.title || kind).toUpperCase()}`;
    copyLayout = null; scheduleCopyFit();

    if (kind === 'image') {
      const url = String(item.mediaUrl || '');
      if (url && (image.dataset.source !== url || !image.naturalWidth)) { image.dataset.source = url; image.src = url; }
      image.alt = String(item.alt || item.title || 'MMA news image');
    }

    if (kind === 'video') {
      const url = String(item.mediaUrl || '');
      if (url && (video.dataset.source !== url || video.error)) {
        waitingSince.delete(video);
        video.pause();
        video.dataset.source = url;
        video.src = url;
        video.load();
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.volume = clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1);
    }
  }

  function syncProgram() {
    const elapsed = rawElapsed();
    const position = timelinePosition(programItems(), elapsed);
    const item = position.item;
    const id = JSON.stringify(item || null);
    if (id !== currentProgramId) {
      currentProgramId = id;
      renderProgramItem(item);
    }

    if (item) progressNode.textContent = `${fmt(position.local)} / ${fmt(item.duration)}`;
    else progressNode.textContent = '00:00 / 00:00';
    showCopyPage(position);

    if (item?.type === 'video' && item.mediaUrl) {
      const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : positive(item.duration);
      const target = mediaDuration > 0 ? mod(position.local, mediaDuration) : position.local;
      if (Number.isFinite(video.duration) && Math.abs((video.currentTime || 0) - target) > .8) {
        try { video.currentTime = target; } catch {}
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.volume = clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1);
      safePlay(video);
    } else { video.pause(); waitingSince.delete(video); }

    if (item?.type === 'youtube') youtube.sync({ id: item.youtubeId, url: item.mediaUrl, time: position.local,
      muted: !soundEnabled || item.videoAudio === false,
      volume: Math.round(clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1) * 100) });

    return { elapsed, position };
  }

  function dbGain(db) {
    const value = Number(db);
    if (!Number.isFinite(value)) return 1;
    return Math.pow(10, value / 20);
  }

  function duckTarget(programItem) {
    if (!programItem || !['video', 'youtube'].includes(programItem.type) || programItem.videoAudio === false) return 1;
    const mode = String(programItem.musicBehavior || channel?.audio?.videoMusic || 'duck').toLowerCase();
    if (mode === 'mute') return 0;
    if (mode === 'keep' || mode === 'keep-playing') return 1;
    const perItem = Number(programItem.duckLevel);
    return clamp(Number.isFinite(perItem) ? perItem : (channel?.audio?.duckLevel ?? .18), 0, 1);
  }

  function baseMusicVolume(track) {
    return clamp(channel?.audio?.master ?? 1, 0, 1)
      * clamp(channel?.audio?.music ?? .72, 0, 1)
      * clamp(dbGain(track?.gainDb ?? 0), 0, 2);
  }

  function ensureAudioSource(element, track, targetTime) {
    if (!track?.url) return;
    const trackId = String(track.id || '') + ':' + track.url;
    if ((element.dataset.trackId !== trackId || element.error)) {
      waitingSince.delete(element);
      element.pause();
      element.dataset.trackId = trackId;
      element.dataset.mediaUrl = track.url;
      element.src = track.url;
      element.load();
    }
    if (Number.isFinite(element.duration) && Math.abs((element.currentTime || 0) - targetTime) > 1.1) {
      try { element.currentTime = Math.max(0, mod(targetTime, element.duration)); } catch {}
    }
  }

  function musicPosition(tracks, elapsed) {
    if (!tracks.length) return null;
    const globalCrossfade = clamp(channel?.audio?.crossfade ?? 2.5, 0, 12);
    const overlaps = tracks.map((track, index) => {
      if (tracks.length < 2) return 0;
      const next = tracks[(index + 1) % tracks.length];
      return Math.min(
        globalCrossfade,
        positive(track.duration) * .45,
        positive(next.duration) * .45
      );
    });
    const slots = tracks.map((track, index) => Math.max(.05, positive(track.duration) - overlaps[index]));
    const total = slots.reduce((sum, value) => sum + value, 0);
    const position = mod(elapsed, total);
    let cursor = 0;
    let index = 0;
    for (; index < tracks.length; index += 1) {
      if (position < cursor + slots[index] || index === tracks.length - 1) break;
      cursor += slots[index];
    }
    const local = Math.max(0, position - cursor);
    const previousIndex = (index - 1 + tracks.length) % tracks.length;
    const incomingOverlap = overlaps[previousIndex];
    const previous = tracks[previousIndex];
    return {
      item: tracks[index],
      index,
      local,
      total,
      previous,
      previousIndex,
      incomingOverlap,
      previousLocal: Math.max(0, positive(previous.duration) - incomingOverlap + local)
    };
  }

  function syncMusic(elapsed, programItem, deltaSeconds) {
    const tracks = musicItems();
    if (!soundEnabled || !tracks.length) {
      setSlotVolume(musicA, 0);
      setSlotVolume(musicB, 0);
      pauseSlot(musicA);
      pauseSlot(musicB);
      return;
    }

    const pos = musicPosition(tracks, elapsed);
    const track = pos?.item;
    if (!track) return;

    const trackId = String(track.id || track.url);
    if (trackId !== currentMusicId) {
      currentMusicId = trackId;
      const swap = activeMusic;
      activeMusic = standbyMusic;
      standbyMusic = swap;
    }

    ensureAudioSource(activeMusic, track, pos.local);

    const inCrossfade = tracks.length > 1
      && pos.incomingOverlap > 0
      && pos.local < pos.incomingOverlap;
    const crossfadeProgress = inCrossfade
      ? clamp(pos.local / pos.incomingOverlap, 0, 1)
      : 1;

    if (inCrossfade) {
      ensureAudioSource(standbyMusic, pos.previous, pos.previousLocal);
      playSlot(standbyMusic);
    } else {
      setSlotVolume(standbyMusic, 0);
      pauseSlot(standbyMusic);
    }

    const desiredDuck = duckTarget(programItem);
    const attack = Math.max(.05, Number(channel?.audio?.duckAttack) || .4);
    const release = Math.max(.05, Number(channel?.audio?.duckRelease) || 1.5);
    const towardDown = desiredDuck < musicLevel;
    const speed = deltaSeconds / (towardDown ? attack : release);
    if (!Number.isFinite(musicLevel)) musicLevel = desiredDuck;
    else musicLevel += (desiredDuck - musicLevel) * clamp(speed, 0, 1);

    const remaining = Math.max(0, positive(track.duration) - pos.local);
    const fadeIn = Math.max(0, Number(track.fadeIn) || 0);
    const fadeOut = Math.max(0, Number(track.fadeOut) || 0);
    const ownFadeIn = fadeIn > 0 ? clamp(pos.local / fadeIn, 0, 1) : 1;
    const ownFadeOut = fadeOut > 0 ? clamp(remaining / fadeOut, 0, 1) : 1;
    const currentEnvelope = Math.min(ownFadeIn, ownFadeOut, crossfadeProgress);

    let previousEnvelope = 0;
    if (inCrossfade) {
      const previousRemaining = Math.max(0, positive(pos.previous.duration) - pos.previousLocal);
      const previousFadeOut = Math.max(0, Number(pos.previous.fadeOut) || 0);
      const ownPreviousFade = previousFadeOut > 0
        ? clamp(previousRemaining / previousFadeOut, 0, 1)
        : 1;
      previousEnvelope = Math.min(ownPreviousFade, 1 - crossfadeProgress);
    }

    setSlotVolume(activeMusic, clamp(baseMusicVolume(track) * musicLevel * currentEnvelope, 0, 1));
    setSlotVolume(standbyMusic, clamp(baseMusicVolume(pos.previous) * musicLevel * previousEnvelope, 0, 1));
    playSlot(activeMusic);
  }

  function updateClock() {
    const now = new Date();
    dateNode.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit'
    }).format(now).toUpperCase();
    clockNode.textContent = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(now).toUpperCase();
  }

  function setSoundState(enabled) {
    soundEnabled = Boolean(enabled);
    youtube?.sound(soundEnabled && timelinePosition(programItems(), rawElapsed()).item?.videoAudio !== false);
    if (soundEnabled) soundBlocked = false;
    if (!monitorMode) {
      try { localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off'); } catch {}
    }
    soundButton.textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
    reportPlayback('');
    soundButton.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
    if (!soundEnabled) {
      pauseSlot(musicA);
      pauseSlot(musicB);
      video.muted = true;
    }
  }

  async function loadState() {
    let next = null;
    let lastError = null;
    if (useDraft && previewOverride) return;
    for (const url of STATE_URLS) {
      try {
        const joiner = url.includes('?') ? '&' : '?';
        const response = await fetch(`${url}${joiner}t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`Broadcast state ${response.status}`);
        next = await response.json();
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!next) throw lastError || new Error('Broadcast state unavailable.');
    if (useDraft && previewOverride) return;
    const selected = useDraft ? next.draft : next.live;
    if (!selected) throw new Error('Broadcast state is empty.');
    const nextRevision = String(selected.revision || selected.updatedAt || next.updatedAt || '');
    state = next;
    if (nextRevision !== revision) {
      revision = nextRevision;
      channel = selected;
      currentProgramId = '';
      currentMusicId = '';
      musicLevel = duckTarget(null);
      failedMedia.clear();
      renderTicker();
      syncProgram();
      if ((channel.music || []).some(track => youtubeVideoId(track.url) || track.youtubeId)) reportPlayback('Replace YouTube music with an uploaded song or a direct audio file in Broadcast Control.');
    } else {
      channel = selected;
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (!message) return;

    if (monitorMode && message.type === 'matlock-broadcast-monitor-sound') {
      setSoundState(Boolean(message.enabled));
      const { elapsed, position } = syncProgram();
      syncMusic(elapsed, position.item, .05);
      return;
    }

    if (!useDraft || message.type !== 'matlock-broadcast-preview' || !message.channel) return;
    previewOverride = true;
    channel = message.channel;
    if (!channel.startedAt) channel.startedAt = new Date().toISOString();
    revision = `preview-${Date.now()}`;
    renderTicker();
    syncProgram();
  });

  soundButton.addEventListener('click', () => {
    setSoundState(!soundEnabled);
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, .05);
  });

  // Called synchronously by the same-origin controller's Listen click so the
  // user activation is available to media.play(), unlike a later message task.
  window.matlockBroadcastSetSound = enabled => {
    setSoundState(enabled);
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, .05);
  };
  setSoundState(soundEnabled);
  updateClock();

  loadState().catch(() => {
    title.textContent = 'BROADCAST OFFLINE';
    bodyCopy.textContent = 'THE CHANNEL WILL RETURN SHORTLY.';
  });

  window.setInterval(() => {
    const now = performance.now();
    const deltaSeconds = Math.max(.016, Math.min(.5, (now - lastTickAt) / 1000));
    lastTickAt = now;
    updateClock();
    for (const element of [video, musicA, musicB]) {
      if (waitingSince.has(element) && Date.now() - waitingSince.get(element) > 15000 && !element.paused) failMedia(element);
    }
    if (!channel) return;
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, deltaSeconds);
  }, 250);

  window.setInterval(() => {
    loadState().catch(() => {});
  }, 12000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastTickAt = performance.now();
      loadState().catch(() => {});
    }
  });
})();
