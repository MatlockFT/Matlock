(() => {
  const root = document.querySelector('[data-mfc-root]');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const useDraft = params.get('mode') === 'draft' || params.get('preview') === 'draft';
  const monitorMode = params.get('monitor') === '1';
  if (params.get('embed') === '1') document.body.dataset.mfcEmbed = 'true';
  if (monitorMode) document.body.dataset.mfcMonitor = 'true';

  const screen = root.querySelector('[data-mfc-screen]');
  function scalePlayer() {
    const embedded = document.body.dataset.mfcEmbed === 'true';
    const maxScale = embedded ? Infinity : 760 / 640;
    const verticalScale = embedded ? innerHeight / 480 : innerHeight / 560;
    const scale = Math.max(.01, Math.min(innerWidth / 640, verticalScale, maxScale));
    root.style.setProperty('--mfc-player-scale', String(scale));
  }
  scalePlayer();
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
  if (video) video.loop = true;
  const panel = root.querySelector('[data-mfc-panel]');
  const youtubeHost = root.querySelector('[data-mfc-youtube]');
  const weatherPanel = root.querySelector('[data-mfc-weather]');
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
  const musicYoutubeHostA = document.querySelector('[data-mfc-music-youtube-a]');
  const musicYoutubeHostB = document.querySelector('[data-mfc-music-youtube-b]');
  const STATE_URLS = [
    'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/broadcast.json',
    '/assets/uploads/broadcast.json',
    'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/data/broadcast.json',
    '/assets/data/broadcast.json'
  ];
  const SOUND_KEY = 'matlock-fight-channel:sound';
  let clockOffsetMs = 0;

  function synchronizedNowMs() {
    return Date.now() + clockOffsetMs;
  }

  async function syncNetworkClock() {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${location.pathname}?clock=${startedAt}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });
      const receivedAt = Date.now();
      const serverTime = Date.parse(response.headers.get('date') || '');
      if (!response.ok || !Number.isFinite(serverTime)) return false;
      const midpoint = (startedAt + receivedAt) / 2;
      const estimatedOffset = (serverTime + 500) - midpoint;
      clockOffsetMs = Math.abs(estimatedOffset) >= 2000 ? estimatedOffset : 0;
      return true;
    } catch {
      return false;
    }
  }

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
  let activeMusicYoutube = null;
  let standbyMusicYoutube = null;
  let lastPoll = 0;
  let previewOverride = false;
  const failedMedia = new Map();
  const pendingPlay = new WeakSet();
  const waitingSince = new WeakMap();
  const measuredMusicDurations = new Map();
  let musicScheduleCache = null;
  let soundBlocked = false;
  const youtube = youtubeHost && window.matlockYoutubePlayer?.(youtubeHost, {
    error: url => {
      failedMedia.set(url, Date.now() + 60000); currentProgramId = '';
      reportPlayback('A YouTube video is unavailable. Continuing with available content; retrying in one minute.');
    },
    blocked: () => {
      soundBlocked = true; setSoundState(false); soundButton.hidden = false;
      reportPlayback('YouTube autoplay was blocked. Click Sound On or the video play button.', true);
    },
    playing: () => { if (!soundBlocked) reportPlayback(''); }
  });

  function createMusicYoutube(host) {
    return host && window.matlockYoutubePlayer?.(host, {
      error: url => {
        failedMedia.set(url, Date.now() + 60000);
        currentMusicId = '';
        reportPlayback('A YouTube music track is unavailable. Continuing with available music; retrying in one minute.');
      },
      blocked: () => {
        soundBlocked = true;
        setSoundState(false);
        soundButton.hidden = false;
        reportPlayback('YouTube blocked background audio. Click Sound On to enable it.', true);
      },
      playing: () => { if (!soundBlocked) reportPlayback(''); }
    });
  }

  const musicYoutubeA = createMusicYoutube(musicYoutubeHostA);
  const musicYoutubeB = createMusicYoutube(musicYoutubeHostB);
  activeMusicYoutube = musicYoutubeA;
  standbyMusicYoutube = musicYoutubeB;

  function reportPlayback(message, blocked = false) {
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
        reportPlayback('Click Sound On in this player to enable audio.', true);
      } else if (error.name !== 'AbortError') failMedia(element);
    }).finally(() => pendingPlay.delete(element));
  }

  for (const element of [video, musicA, musicB]) {
    element.addEventListener('error', () => failMedia(element));
    element.addEventListener('waiting', () => { if (!waitingSince.has(element)) waitingSince.set(element, Date.now()); });
    element.addEventListener('playing', () => { waitingSince.delete(element); if (!soundBlocked) reportPlayback(''); });
    if (element === musicA || element === musicB) {
      const rememberDuration = () => {
        const key = element.dataset.trackId;
        const duration = Number(element.duration);
        if (key && Number.isFinite(duration) && duration > .25) measuredMusicDurations.set(key, duration);
      };
      element.addEventListener('loadedmetadata', rememberDuration);
      element.addEventListener('durationchange', rememberDuration);
    }
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

  function musicTrackKey(track) {
    return String(track?.id || '') + ':' + String(track?.url || '');
  }

  function musicDuration(track) {
    const measured = measuredMusicDurations.get(musicTrackKey(track));
    if (Number.isFinite(measured) && measured > .25) return measured;
    return positive(track?.sourceDuration || track?.duration);
  }

  function musicItems() {
    return Array.isArray(channel?.music) ? channel.music.filter(item => {
      if (!sourceAvailable(item?.url) || musicDuration(item) <= 0) return false;
      const youtubeId = String(item.youtubeId || youtubeVideoId(item.url) || '');
      return !youtubeId || Boolean(musicYoutubeA && musicYoutubeB);
    }) : [];
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
    return Math.max(0, (synchronizedNowMs() - stamp) / 1000);
  }

  function textForTicker() {
    const entries = Array.isArray(channel?.ticker)
      ? channel.ticker.map(value => String(value || '').trim()).filter(Boolean)
      : String(channel?.ticker || '').split('|').map(value => value.trim()).filter(Boolean);
    return (entries.length ? entries : ['MATLOCK FIGHT CHANNEL', 'MMA NEWS', 'RESULTS', 'BREAKDOWNS']).join('   •   ');
  }

  let tickerMeasureFrame = 0;
  let tickerBaseLoop = '';

  function ensureTickerCoverage() {
    if (!ticker || !tickerClone || !tickerBaseLoop) return;
    ticker.textContent = tickerBaseLoop;
    tickerClone.textContent = tickerBaseLoop;
    const stageWidth = Math.max(1, screen?.clientWidth || 640);
    const baseWidth = Math.max(1, ticker.offsetWidth);
    if (baseWidth < stageWidth * 1.35) {
      const repeats = Math.max(2, Math.ceil((stageWidth * 1.35) / baseWidth));
      const expanded = tickerBaseLoop.repeat(repeats);
      ticker.textContent = expanded;
      tickerClone.textContent = expanded;
    }
  }

  function updateTickerMetrics({ restart = false } = {}) {
    if (!tickerTrack || !ticker) return;
    ensureTickerCoverage();
    const speed = clamp(Number(channel?.tickerSpeed) || 1, .4, 2.5);
    const sequenceWidth = Math.max(1, ticker.offsetWidth);
    const stageWidth = Math.max(1, screen?.clientWidth || 640);
    const pixelsPerSecond = Math.max(1, stageWidth * .15 * speed);
    const seconds = clamp(sequenceWidth / pixelsPerSecond, 8, 300);

    const phase = seconds > 0 ? mod(rawElapsed(), seconds) : 0;
    tickerTrack.style.setProperty('--mfc-ticker-distance', '-' + sequenceWidth + 'px');
    tickerTrack.style.setProperty('--mfc-ticker-seconds', seconds + 's');
    tickerTrack.style.setProperty('--mfc-ticker-phase', '-' + phase + 's');

    if (restart) {
      tickerTrack.style.animation = 'none';
      void tickerTrack.offsetWidth;
      tickerTrack.style.removeProperty('animation');
    }
  }

  function scheduleTickerMetrics(options = {}) {
    if (tickerMeasureFrame) cancelAnimationFrame(tickerMeasureFrame);
    tickerMeasureFrame = requestAnimationFrame(() => {
      tickerMeasureFrame = 0;
      updateTickerMetrics(options);
    });
  }

  function renderTicker() {
    const text = textForTicker();
    tickerBaseLoop = text + '   •   ';
    ensureTickerCoverage();
    scheduleTickerMetrics({ restart: true });
  }

  function setMediaMode(kind) {
    const isVideo = kind === 'video';
    const isImage = kind === 'image';
    const isYoutube = kind === 'youtube';
    const isWeather = kind === 'weather';
    youtubeHost.hidden = !isYoutube;
    if (!isYoutube) youtube?.stop();
    if (!isWeather) window.matlockFightCityWeather?.hide?.();
    screen.classList.remove('is-compact-youtube');
    if (isYoutube) {
      const bounds = panel.getBoundingClientRect();
      screen.classList.toggle('is-compact-youtube', bounds.width < 200 || bounds.height < 200);
    }
    panel.classList.toggle('has-youtube', isYoutube);
    panel.classList.toggle('has-weather', isWeather);
    video.hidden = !isVideo;
    image.hidden = !isImage;
    if (weatherPanel) weatherPanel.hidden = !isWeather;
    panel.classList.toggle('has-media', isVideo || isImage || isYoutube);
    eyebrow.hidden = isVideo || isImage || isYoutube || isWeather;
    title.hidden = isVideo || isImage || isYoutube || isWeather;
    bodyCopy.hidden = isVideo || isImage || isYoutube || isWeather;
    copy.hidden = isVideo || isImage || isYoutube || isWeather;
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

  const inkContext = document.createElement('canvas').getContext('2d');
  function centerTextInk(node) {
    if (!inkContext) return;
    const style = getComputedStyle(node);
    inkContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const before = getComputedStyle(node, '::before').content;
    const prefix = before && before !== 'none' && before !== 'normal' ? before.slice(1, -1) : '';
    // A stable footer baseline prevents the clock from moving as digits change.
    const metrics = inkContext.measureText(node === clockNode ? '12:00:00 PM' : prefix + node.textContent);
    // Center the visible glyphs, accounting for the retro fonts' unusual baselines.
    const shift = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent
      - metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 2;
    node.style.setProperty('--mfc-ink-shift', Number.isFinite(shift) ? shift + 'px' : '0px');
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
    largestFit(1, parseFloat(getComputedStyle(header).fontSize), size => { header.style.fontSize = size + 'px'; centerTextInk(header); },
      () => header.scrollWidth <= header.clientWidth + 1
        && Math.max(header.scrollHeight, parseFloat(getComputedStyle(header).height))
          + 2 * Math.abs(parseFloat(header.style.getPropertyValue('--mfc-ink-shift')) || 0) <= headerHeight - 1);
    [header, dateNode, clockNode, ticker, tickerClone].forEach(centerTextInk);
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
      const titleHeight = title.offsetHeight, eyebrowHeight = eyebrow.offsetHeight;
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
  window.addEventListener('resize', () => {
    scalePlayer();
    setMediaMode(timelinePosition(programItems(), rawElapsed()).item?.type || 'headline');
    scheduleCopyFit();
    scheduleTickerMetrics();
  });
  new ResizeObserver(scheduleCopyFit).observe(panel);
  document.fonts?.ready.then(() => { scheduleCopyFit(); scheduleTickerMetrics({ restart: true }); });
  document.fonts?.addEventListener('loadingdone', () => { scheduleCopyFit(); scheduleTickerMetrics({ restart: true }); });

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
      video: 'MMA VIDEO',
      weather: 'FIGHT CITY FORECAST'
    }[kind] || 'MMA NEWS')).toUpperCase();

    eyebrow.textContent = String(item.eyebrow || ({
      headline: 'LATEST',
      results: 'RESULTS',
      event: 'NEXT EVENT',
      breaking: 'BREAKING',
      image: 'PHOTO',
      video: 'VIDEO',
      weather: 'LOCAL WEATHER'
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

  function preloadUpcomingVideo(items, currentIndex) {
    if (!video || !Array.isArray(items) || items.length < 2) return;
    for (let step = 1; step < items.length; step += 1) {
      const candidate = items[(currentIndex + step + items.length) % items.length];
      if (candidate?.type !== 'video' || !candidate.mediaUrl || !sourceAvailable(candidate.mediaUrl)) continue;
      const url = String(candidate.mediaUrl);
      if (video.dataset.source === url && !video.error) return;
      waitingSince.delete(video);
      video.pause();
      video.preload = 'auto';
      video.dataset.source = url;
      video.src = url;
      video.load();
      return;
    }
  }

  function syncProgram() {
    const elapsed = rawElapsed();
    const items = programItems();
    const position = timelinePosition(items, elapsed);
    const item = position.item;
    const id = JSON.stringify(item || null);
    if (id !== currentProgramId) {
      currentProgramId = id;
      renderProgramItem(item);
    }

    if (item) progressNode.textContent = `${fmt(position.local)} / ${fmt(item.duration)}`;
    else progressNode.textContent = '00:00 / 00:00';
    showCopyPage(position);

    if (item?.type === 'weather') {
      window.matlockFightCityWeather?.show?.(item, position);
    }

    if (item?.type === 'video' && item.mediaUrl) {
      video.preload = 'auto';
      const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : positive(item.duration);
      const target = mediaDuration > 0 ? mod(position.local, mediaDuration) : position.local;
      if (Number.isFinite(video.duration) && Math.abs((video.currentTime || 0) - target) > .8) {
        try { video.currentTime = target; } catch {}
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.volume = clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1);
      safePlay(video);
    } else {
      video.pause();
      waitingSince.delete(video);
      preloadUpcomingVideo(items, position.index);
    }

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
    const trackId = musicTrackKey(track);
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

  function youtubeMusicId(track) {
    return String(track?.youtubeId || youtubeVideoId(track?.url) || '');
  }

  function stopMusicSlot(element, youtubePlayer) {
    setSlotVolume(element, 0);
    pauseSlot(element);
    youtubePlayer?.stop();
  }

  function syncMusicSlot(element, youtubePlayer, track, targetTime, volume) {
    const level = clamp(volume, 0, 1);
    const youtubeId = youtubeMusicId(track);
    if (youtubeId) {
      setSlotVolume(element, 0);
      pauseSlot(element);
      youtubePlayer?.sync({
        id: youtubeId,
        url: track.url,
        time: Math.max(0, targetTime),
        muted: !soundEnabled || level <= .001,
        volume: Math.round(level * 100)
      });
      return;
    }

    youtubePlayer?.stop();
    ensureAudioSource(element, track, targetTime);
    setSlotVolume(element, level);
    playSlot(element);
  }

  function musicRepeatMode() {
    return String(channel?.audio?.musicRepeat || 'shuffle').toLowerCase() === 'fixed' ? 'fixed' : 'shuffle';
  }

  function musicRepeatKey(track) {
    return String(track?.url || track?.id || '');
  }

  function musicSeed(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function musicRandom(seedState) {
    let value = seedState.value += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }

  function musicCycleOrder(tracks, cycleIndex, previousOrder) {
    const order = tracks.slice();
    if (cycleIndex === 0 || musicRepeatMode() === 'fixed' || order.length < 2) return order;

    const seedState = {
      value: musicSeed([
        channel?.startedAt || channel?.updatedAt || '',
        tracks.map(musicTrackKey).join('|'),
        cycleIndex
      ].join('::'))
    };

    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(musicRandom(seedState) * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }

    const previousLast = previousOrder?.[previousOrder.length - 1];
    if (previousLast && musicRepeatKey(order[0]) === musicRepeatKey(previousLast)) {
      const swap = order.findIndex((track, index) => index > 0 && musicRepeatKey(track) !== musicRepeatKey(previousLast));
      if (swap > 0) [order[0], order[swap]] = [order[swap], order[0]];
    }

    if (order.length > 2 && previousOrder?.length === order.length
        && order.every((track, index) => musicTrackKey(track) === musicTrackKey(previousOrder[index]))) {
      [order[1], order[2]] = [order[2], order[1]];
    }

    return order;
  }

  function musicTransitionOverlap(first, second) {
    if (!first || !second || musicRepeatKey(first) === musicRepeatKey(second)) return 0;
    const globalCrossfade = clamp(channel?.audio?.crossfade ?? 2.5, 0, 12);
    return Math.min(globalCrossfade, musicDuration(first) * .45, musicDuration(second) * .45);
  }

  function musicScheduleSignature(tracks) {
    return JSON.stringify([
      channel?.startedAt || channel?.updatedAt || '',
      musicRepeatMode(),
      clamp(channel?.audio?.crossfade ?? 2.5, 0, 12),
      tracks.map(track => [musicTrackKey(track), musicDuration(track)])
    ]);
  }

  function ensureMusicCycle(cache, tracks, cycleIndex) {
    while (cache.cycles.length <= cycleIndex) {
      const index = cache.cycles.length;
      const previous = cache.cycles[index - 1] || null;
      cache.cycles.push(musicCycleOrder(tracks, index, previous));
    }
  }

  function appendMusicCycle(cache, tracks, cycleIndex) {
    ensureMusicCycle(cache, tracks, cycleIndex + 1);
    const order = cache.cycles[cycleIndex];
    const nextOrder = cache.cycles[cycleIndex + 1];

    for (let index = 0; index < order.length; index += 1) {
      const item = order[index];
      const previousEntry = cache.entries[cache.entries.length - 1] || null;
      const previous = previousEntry?.item || null;
      const next = index < order.length - 1 ? order[index + 1] : nextOrder[0] || null;
      const duration = musicDuration(item);
      const incomingOverlap = previous ? musicTransitionOverlap(previous, item) : 0;
      const outgoingOverlap = next ? musicTransitionOverlap(item, next) : 0;
      const start = cache.end;
      const end = start + Math.max(.05, duration - outgoingOverlap);

      cache.entries.push({
        item,
        index,
        cycleIndex,
        start,
        end,
        duration,
        previous,
        previousDuration: previous ? musicDuration(previous) : 0,
        incomingOverlap,
        next
      });
      cache.end = end;
    }

    cache.builtCycles = cycleIndex + 1;
  }

  function musicPosition(tracks, elapsed) {
    if (!tracks.length) return null;
    const signature = musicScheduleSignature(tracks);
    if (!musicScheduleCache || musicScheduleCache.signature !== signature) {
      musicScheduleCache = {
        signature,
        cycles: [],
        entries: [],
        end: 0,
        builtCycles: 0
      };
    }

    const target = Math.max(0, elapsed);
    let guard = 0;
    while (musicScheduleCache.end <= target && guard < 5000) {
      appendMusicCycle(musicScheduleCache, tracks, musicScheduleCache.builtCycles);
      guard += 1;
    }

    const entries = musicScheduleCache.entries;
    if (!entries.length) return null;
    let low = 0;
    let high = entries.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (target < entries[middle].end) high = middle;
      else low = middle + 1;
    }

    const entry = entries[Math.min(low, entries.length - 1)];
    const local = Math.max(0, target - entry.start);
    return {
      item: entry.item,
      index: entry.index,
      cycleIndex: entry.cycleIndex,
      local,
      total: entry.end,
      duration: entry.duration,
      previous: entry.previous,
      previousDuration: entry.previousDuration,
      incomingOverlap: entry.incomingOverlap,
      previousLocal: entry.previous
        ? Math.max(0, entry.previousDuration - entry.incomingOverlap + local)
        : 0,
      next: entry.next
    };
  }

  function primeNextMusicTrack(tracks, position, inCrossfade) {
    if (inCrossfade || tracks.length < 2 || !standbyMusic) return;
    const next = position.next;
    if (!next || youtubeMusicId(next)) return;
    ensureAudioSource(standbyMusic, next, 0);
  }

  function syncMusic(elapsed, programItem, deltaSeconds) {
    const tracks = musicItems();
    if (!soundEnabled || !tracks.length) {
      stopMusicSlot(musicA, musicYoutubeA);
      stopMusicSlot(musicB, musicYoutubeB);
      return;
    }

    const pos = musicPosition(tracks, elapsed);
    const track = pos?.item;
    if (!track) return;

    const trackId = String(track.id || track.url);
    if (trackId !== currentMusicId) {
      currentMusicId = trackId;
      const audioSwap = activeMusic;
      activeMusic = standbyMusic;
      standbyMusic = audioSwap;
      const youtubeSwap = activeMusicYoutube;
      activeMusicYoutube = standbyMusicYoutube;
      standbyMusicYoutube = youtubeSwap;
    }

    const inCrossfade = tracks.length > 1
      && pos.incomingOverlap > 0
      && pos.local < pos.incomingOverlap;
    const crossfadeProgress = inCrossfade
      ? clamp(pos.local / pos.incomingOverlap, 0, 1)
      : 1;
    const incomingBlend = inCrossfade ? Math.sin(crossfadeProgress * Math.PI / 2) : 1;
    const outgoingBlend = inCrossfade ? Math.cos(crossfadeProgress * Math.PI / 2) : 0;

    primeNextMusicTrack(tracks, pos, inCrossfade);

    const desiredDuck = duckTarget(programItem);
    const attack = Math.max(.05, Number(channel?.audio?.duckAttack) || .4);
    const release = Math.max(.05, Number(channel?.audio?.duckRelease) || 1.5);
    const towardDown = desiredDuck < musicLevel;
    const speed = deltaSeconds / (towardDown ? attack : release);
    if (!Number.isFinite(musicLevel)) musicLevel = desiredDuck;
    else musicLevel += (desiredDuck - musicLevel) * clamp(speed, 0, 1);

    const currentDuration = pos.duration || musicDuration(track);
    const remaining = Math.max(0, currentDuration - pos.local);
    const fadeIn = Math.max(0, Number(track.fadeIn) || 0);
    const fadeOut = Math.max(0, Number(track.fadeOut) || 0);
    const ownFadeIn = fadeIn > 0 ? clamp(pos.local / fadeIn, 0, 1) : 1;
    const ownFadeOut = fadeOut > 0 ? clamp(remaining / fadeOut, 0, 1) : 1;
    const currentEnvelope = Math.min(ownFadeIn, ownFadeOut, incomingBlend);
    const currentVolume = clamp(baseMusicVolume(track) * musicLevel * currentEnvelope, 0, 1);

    let previousVolume = 0;
    if (inCrossfade) {
      const previousDuration = pos.previousDuration || musicDuration(pos.previous);
      const previousRemaining = Math.max(0, previousDuration - pos.previousLocal);
      const previousFadeOut = Math.max(0, Number(pos.previous.fadeOut) || 0);
      const ownPreviousFade = previousFadeOut > 0
        ? clamp(previousRemaining / previousFadeOut, 0, 1)
        : 1;
      const previousEnvelope = Math.min(ownPreviousFade, outgoingBlend);
      previousVolume = clamp(baseMusicVolume(pos.previous) * musicLevel * previousEnvelope, 0, 1);
    }

    syncMusicSlot(activeMusic, activeMusicYoutube, track, pos.local, currentVolume);
    if (inCrossfade) syncMusicSlot(standbyMusic, standbyMusicYoutube, pos.previous, pos.previousLocal, previousVolume);
    else stopMusicSlot(standbyMusic, standbyMusicYoutube);
  }

  const WORLD_CLOCKS = [
    { zone: 'America/Chicago' },
    { zone: 'America/New_York' },
    { zone: 'America/Los_Angeles' },
    { zone: 'Europe/London' },
    { zone: 'Asia/Tokyo', label: 'JST' },
    { zone: 'Australia/Sydney' }
  ];
  const WORLD_CLOCK_ROTATE_MS = 8000;

  function zoneAbbreviation(now, zone, fallback = '') {
    if (fallback) return fallback;
    try {
      const part = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        timeZoneName: 'short'
      }).formatToParts(now).find(row => row.type === 'timeZoneName');
      return String(part?.value || '').toUpperCase();
    } catch {
      return '';
    }
  }

  function updateClock() {
    const nowMs = synchronizedNowMs();
    const now = new Date(nowMs);
    const index = Math.floor(nowMs / WORLD_CLOCK_ROTATE_MS) % WORLD_CLOCKS.length;
    const clock = WORLD_CLOCKS[Math.max(0, index)] || WORLD_CLOCKS[0];
    dateNode.textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: clock.zone,
      weekday: 'short',
      month: 'short',
      day: '2-digit'
    }).format(now).toUpperCase();
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: clock.zone,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(now).toUpperCase();
    const zone = zoneAbbreviation(now, clock.zone, clock.label);
    clockNode.dataset.zone = clock.zone;
    clockNode.textContent = zone ? `${time} ${zone}` : time;
    [dateNode, clockNode].forEach(centerTextInk);
  }

  function setSoundState(enabled) {
    soundEnabled = Boolean(enabled);
    youtube?.sound(soundEnabled && timelinePosition(programItems(), rawElapsed()).item?.videoAudio !== false);
    musicYoutubeA?.sound(soundEnabled);
    musicYoutubeB?.sound(soundEnabled);
    if (soundEnabled) soundBlocked = false;
    if (!monitorMode) {
      try { localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off'); } catch {}
    }
    const soundLabel = soundEnabled ? 'Mute broadcast' : 'Unmute broadcast';
    soundButton.setAttribute('aria-label', soundLabel);
    soundButton.setAttribute('title', soundLabel);
    reportPlayback('');
    soundButton.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
    if (!soundEnabled) {
      stopMusicSlot(musicA, musicYoutubeA);
      stopMusicSlot(musicB, musicYoutubeB);
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
  let broadcastRevealed = false;

  async function revealBroadcast() {
    if (broadcastRevealed) return;
    broadcastRevealed = true;

    try { await document.fonts?.ready; } catch {}
    if (channel) {
      syncProgram();
      fitBroadcastCopy();
      updateTickerMetrics({ restart: true });
    }
    updateClock();

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.classList.remove('mfc-booting');
  }

  setSoundState(soundEnabled);
  updateClock();

  async function initializeBroadcast() {
    await syncNetworkClock();
    await loadState();
    await revealBroadcast();
  }

  initializeBroadcast().catch(() => {
    title.textContent = 'BROADCAST OFFLINE';
    bodyCopy.textContent = 'THE CHANNEL WILL RETURN SHORTLY.';
    revealBroadcast();
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

  window.setInterval(() => {
    syncNetworkClock().then(() => {
      if (!channel) return;
      updateClock();
      syncProgram();
      scheduleTickerMetrics({ restart: true });
    });
  }, 300000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastTickAt = performance.now();
      Promise.allSettled([syncNetworkClock(), loadState()]).then(() => {
        if (!channel) return;
        updateClock();
        syncProgram();
        scheduleTickerMetrics({ restart: true });
      });
    }
  });
})();
