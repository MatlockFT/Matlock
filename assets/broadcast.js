(() => {
  const root = document.querySelector('[data-mfc-root]');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const useDraft = params.get('mode') === 'draft' || params.get('preview') === 'draft';
  const monitorMode = params.get('monitor') === '1';
  const controlsMode = params.get('controls') === '1';
  const obsMode = params.get('obs') === '1';
  if (params.get('embed') === '1') document.body.dataset.mfcEmbed = 'true';
  if (monitorMode) document.body.dataset.mfcMonitor = 'true';
  if (controlsMode) document.body.dataset.mfcControls = 'true';
  if (obsMode) document.body.dataset.mfcObs = 'true';

  const screen = root.querySelector('[data-mfc-screen]');
  function scalePlayer() {
    const embedded = document.body.dataset.mfcEmbed === 'true';
    const controls = document.body.dataset.mfcControls === 'true';
    // The default /broadcast/ feed is OBS-clean: scale the 640x480 stage against
    // the full browser-source canvas with no room reserved for external controls.
    const maxScale = (embedded || !controls) ? Infinity : 760 / 640;
    const verticalScale = (controls && !embedded) ? innerHeight / 560 : innerHeight / 480;
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
  const captionOverlay = root.querySelector('[data-mfc-captions]');
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
  const captionCache = new Map();
  let musicScheduleCache = null;
  let currentCaptionCacheKey = '';
  let currentCaptionCues = [];
  let soundBlocked = false;
  const youtube = youtubeHost && window.matlockYoutubePlayer?.(youtubeHost, {
    error: url => {
      failedMedia.set(url, Date.now() + 60000); currentProgramId = '';
      reportPlayback('A YouTube video is unavailable. Continuing with available content; retrying in one minute.');
    },
    blocked: () => {
      soundBlocked = true;
      if (!obsMode) {
        setSoundState(false);
        soundButton.hidden = false;
      }
      reportPlayback(obsMode
        ? 'OBS browser audio playback was blocked; keeping audio armed for retry.'
        : 'YouTube autoplay was blocked. Click the broadcast to enable sound.', true);
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
        if (!obsMode) {
          setSoundState(false);
          soundButton.hidden = false;
        }
        reportPlayback(obsMode
          ? 'OBS browser music playback was blocked; keeping audio armed for retry.'
          : 'Background audio was blocked. Click the broadcast to enable sound.', true);
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

  let lastPlayheadReportAt = 0;
  function reportPlayhead() {
    if (!monitorMode || window.parent === window || !channel) return;
    const now = performance.now();
    if (now - lastPlayheadReportAt < 450) return;
    lastPlayheadReportAt = now;

    const program = timelinePosition(programItems(), programElapsed());
    const music = musicPosition(musicItems(), rawElapsed());
    window.parent.postMessage({
      type: 'matlock-broadcast-playhead',
      revision: String(channel.revision || ''),
      programItemId: String(program.item?.id || ''),
      programRemaining: program.item ? Math.max(0, positive(program.item.duration) - program.local) : 0,
      programLocal: program.local,
      musicTrackId: String(music?.item?.id || music?.item?.url || ''),
      musicRemaining: music ? Math.max(0, music.slotRemaining ?? (music.duration - music.local)) : 0,
      musicLocal: music?.local || 0,
      sentAt: Date.now()
    }, location.origin);
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
        if (!obsMode) {
          setSoundState(false);
          soundButton.hidden = false;
        }
        reportPlayback(obsMode ? 'OBS browser audio autoplay is blocked; retrying.' : 'Click Sound On in this player to enable audio.', true);
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
  image.addEventListener('load', () => {
    const item = timelinePosition(programItems(), programElapsed()).item;
    if (item?.type === 'image') applyMediaFraming(image, item);
  });
  video.addEventListener('loadedmetadata', () => {
    const item = timelinePosition(programItems(), programElapsed()).item;
    if (item?.type === 'video') applyMediaFraming(video, item);
  });

  try { soundEnabled = localStorage.getItem(SOUND_KEY) === 'on'; } catch {}
  // OBS browser sources do not have an interactive sound button. The dedicated
  // ?obs=1 feed starts with program and music audio enabled so OBS can route it.
  if (obsMode) soundEnabled = true;
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

  function elapsedFrom(value) {
    const stamp = Date.parse(value || '');
    if (!Number.isFinite(stamp)) return 0;
    return Math.max(0, (synchronizedNowMs() - stamp) / 1000);
  }

  // The continuous clock drives music and ticker phase. Program can be cut to a
  // new rundown at a clean item boundary without resetting the audio bed.
  function rawElapsed() {
    if (!channel) return 0;
    return elapsedFrom(channel.musicStartedAt || channel.startedAt || channel.updatedAt || '');
  }

  function programElapsed() {
    if (!channel) return 0;
    return elapsedFrom(channel.programStartedAt || channel.startedAt || channel.updatedAt || '');
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

  function derivedCaptionKey(item) {
    const explicit = String(item?.captionKey || '').trim();
    if (explicit) return explicit;
    try {
      const name = decodeURIComponent(new URL(String(item?.mediaUrl || ''), location.href).pathname.split('/').pop() || '');
      const stem = name.replace(/\.[^.]+$/, '');
      return /^broadcast-video-/i.test(stem)
        ? stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
        : '';
    } catch {
      return '';
    }
  }

  function captionSource(item) {
    const key = derivedCaptionKey(item);
    if (!key || item?.captionsEnabled === false) return null;
    const revision = String(item?.captionRevision || '1');
    return {
      key,
      cacheKey: key + ':' + revision,
      url: 'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/broadcast/captions/'
        + encodeURIComponent(key) + '.vtt?v=' + encodeURIComponent(revision)
    };
  }

  function parseVttTime(value) {
    const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
    if (!match) return NaN;
    return (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + Number(match[4]) / 1000;
  }

  function parseVtt(value) {
    const blocks = String(value || '').replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex(line => line.includes('-->'));
      if (timingIndex < 0) continue;
      const [startText, endText] = lines[timingIndex].split('-->').map(part => part.trim().split(/\s+/)[0]);
      const start = parseVttTime(startText);
      const end = parseVttTime(endText);
      const text = lines.slice(timingIndex + 1).join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
    }
    return cues;
  }

  function clearCaptions() {
    currentCaptionCacheKey = '';
    currentCaptionCues = [];
    if (!captionOverlay) return;
    captionOverlay.hidden = true;
    captionOverlay.dataset.captionText = '';
  }

  async function ensureCaptions(item) {
    const source = captionSource(item);
    if (!source) {
      clearCaptions();
      return;
    }

    const cached = captionCache.get(source.cacheKey);
    if (cached?.state === 'ready') {
      currentCaptionCacheKey = source.cacheKey;
      currentCaptionCues = cached.cues;
      return;
    }
    if (cached?.state === 'loading' || (cached?.retryAt || 0) > Date.now()) return;

    captionCache.set(source.cacheKey, { state: 'loading', cues: [] });
    try {
      const response = await fetch(source.url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Object.assign(new Error('captions unavailable'), { status: response.status });
      const cues = parseVtt(await response.text());
      captionCache.set(source.cacheKey, { state: 'ready', cues });
      if (captionSource(timelinePosition(programItems(), programElapsed()).item)?.cacheKey === source.cacheKey) {
        currentCaptionCacheKey = source.cacheKey;
        currentCaptionCues = cues;
      }
    } catch (error) {
      captionCache.set(source.cacheKey, {
        state: 'waiting',
        cues: [],
        retryAt: Date.now() + (error?.status === 404 ? 15000 : 45000)
      });
    }
  }

  function syncCaptions(item) {
    if (!captionOverlay || item?.type !== 'video') {
      clearCaptions();
      return;
    }
    const source = captionSource(item);
    if (!source) {
      clearCaptions();
      return;
    }

    if (currentCaptionCacheKey !== source.cacheKey) {
      currentCaptionCacheKey = source.cacheKey;
      currentCaptionCues = captionCache.get(source.cacheKey)?.cues || [];
      void ensureCaptions(item);
    } else if (!currentCaptionCues.length) {
      void ensureCaptions(item);
    }

    const time = Number(video?.currentTime) || 0;
    const cue = currentCaptionCues.find(row => time >= row.start && time < row.end);
    captionOverlay.dataset.captionText = cue?.text || '';
    captionOverlay.hidden = !cue?.text;
  }

  function mediaFraming(item) {
    const fallbackFit = String(item?.type || '').toLowerCase() === 'image' ? 'contain' : 'cover';
    const fit = ['cover', 'contain', 'fill', 'none'].includes(String(item?.mediaFit || '').toLowerCase())
      ? String(item.mediaFit).toLowerCase()
      : fallbackFit;
    const scale = clamp(item?.mediaScale == null ? 100 : item.mediaScale, 25, 300);
    const x = clamp(item?.mediaX == null ? 50 : item.mediaX, 0, 100);
    const y = clamp(item?.mediaY == null ? 50 : item.mediaY, 0, 100);
    return { fit, scale, x, y };
  }

  function mediaIntrinsicSize(element) {
    if (!element) return { width: 0, height: 0 };
    if (element.tagName === 'VIDEO') {
      return { width: positive(element.videoWidth), height: positive(element.videoHeight) };
    }
    return { width: positive(element.naturalWidth), height: positive(element.naturalHeight) };
  }

  function coverScaleFor(element) {
    const intrinsic = mediaIntrinsicSize(element);
    const width = Math.max(1, element.clientWidth || panel?.clientWidth || 1);
    const height = Math.max(1, element.clientHeight || panel?.clientHeight || 1);
    if (!intrinsic.width || !intrinsic.height) return 1;

    const contain = Math.min(width / intrinsic.width, height / intrinsic.height);
    const containedWidth = intrinsic.width * contain;
    const containedHeight = intrinsic.height * contain;
    return Math.max(width / Math.max(1, containedWidth), height / Math.max(1, containedHeight));
  }

  function applyMediaFraming(element, item) {
    if (!element) return;
    const framing = mediaFraming(item);
    const userScale = framing.scale / 100;
    let baseScale = 1;

    // Keep the complete source available underneath the framing transform.
    // Cover is produced by scaling a contained source until it fills the frame,
    // rather than cropping first. This lets zooming back out reveal the source.
    if (framing.fit === 'cover') {
      element.style.objectFit = 'contain';
      baseScale = coverScaleFor(element);
    } else {
      element.style.objectFit = framing.fit;
    }

    element.style.objectPosition = framing.x + '% ' + framing.y + '%';
    element.style.transformOrigin = framing.x + '% ' + framing.y + '%';
    element.style.transform = 'scale(' + (baseScale * userScale) + ')';
    element.dataset.mediaBaseScale = String(baseScale);
  }

  function installMediaFramingDrag(element) {
    if (!monitorMode || !element) return;
    element.style.cursor = 'grab';
    element.style.touchAction = 'none';
    let drag = null;

    const send = (item, commit) => {
      if (!item || window.parent === window) return;
      window.parent.postMessage({
        type: 'matlock-broadcast-media-framing',
        itemId: item.id,
        mediaX: clamp(item.mediaX == null ? 50 : item.mediaX, 0, 100),
        mediaY: clamp(item.mediaY == null ? 50 : item.mediaY, 0, 100),
        commit: Boolean(commit)
      }, location.origin);
    };

    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      const item = timelinePosition(programItems(), programElapsed()).item;
      if (!item || !['image', 'video'].includes(item.type)) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      drag = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        mediaX: clamp(item.mediaX == null ? 50 : item.mediaX, 0, 100),
        mediaY: clamp(item.mediaY == null ? 50 : item.mediaY, 0, 100)
      };
      element.setPointerCapture?.(event.pointerId);
      element.style.cursor = 'grabbing';
    });

    element.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const dx = (event.clientX - drag.startX) / drag.width * 100;
      const dy = (event.clientY - drag.startY) / drag.height * 100;
      drag.item.mediaX = clamp(drag.mediaX - dx, 0, 100);
      drag.item.mediaY = clamp(drag.mediaY - dy, 0, 100);
      applyMediaFraming(element, drag.item);
      send(drag.item, false);
    });

    const finish = event => {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const item = drag.item;
      try { element.releasePointerCapture?.(drag.pointerId); } catch {}
      drag = null;
      element.style.cursor = 'grab';
      send(item, true);
    };
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  }

  installMediaFramingDrag(image);
  installMediaFramingDrag(video);

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
    if (!isVideo && captionOverlay) {
      captionOverlay.hidden = true;
      captionOverlay.dataset.captionText = '';
    }
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
    const item = timelinePosition(programItems(), programElapsed()).item;
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
    showCopyPage(timelinePosition(programItems(), programElapsed()));
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
    const item = timelinePosition(programItems(), programElapsed()).item;
    setMediaMode(item?.type || 'headline');
    if (item?.type === 'image') applyMediaFraming(image, item);
    if (item?.type === 'video') applyMediaFraming(video, item);
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
      applyMediaFraming(image, item);
      if (url && (image.dataset.source !== url || !image.naturalWidth)) { image.dataset.source = url; image.src = url; }
      image.alt = String(item.alt || item.title || 'MMA news image');
    }

    if (kind === 'video') {
      const url = String(item.mediaUrl || '');
      applyMediaFraming(video, item);
      if (url && (video.dataset.source !== url || video.error)) {
        waitingSince.delete(video);
        video.pause();
        video.dataset.source = url;
        video.src = url;
        video.load();
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.volume = clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1);
      void ensureCaptions(item);
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
    const programTime = programElapsed();
    const items = programItems();
    const position = timelinePosition(items, programTime);
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
      syncCaptions(item);
    } else {
      clearCaptions();
      video.pause();
      waitingSince.delete(video);
      preloadUpcomingVideo(items, position.index);
    }

    if (item?.type === 'youtube') youtube.sync({ id: item.youtubeId, url: item.mediaUrl, time: position.local,
      muted: !soundEnabled || item.videoAudio === false,
      volume: Math.round(clamp(channel?.audio?.master ?? 1, 0, 1) * clamp(channel?.audio?.video ?? 1, 0, 1) * 100) });

    return { elapsed: rawElapsed(), programElapsed: programTime, position };
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
        channel?.musicStartedAt || channel?.startedAt || channel?.updatedAt || '',
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
      channel?.musicStartedAt || channel?.startedAt || channel?.updatedAt || '',
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
    let previous = entry.previous;
    let previousDuration = entry.previousDuration;
    let incomingOverlap = entry.incomingOverlap;
    let previousLocal = previous
      ? Math.max(0, previousDuration - incomingOverlap + local)
      : 0;

    // When a newly staged music set becomes active, crossfade out of the song
    // that was already on air instead of cutting it at the deck handoff.
    const transitionFrom = channel?.musicTransitionFrom;
    const transitionOverlap = Math.max(0, Number(channel?.musicTransitionOverlap) || 0);
    if (entry.cycleIndex === 0 && entry.index === 0 && transitionFrom && transitionOverlap > 0 && local < transitionOverlap) {
      previous = transitionFrom;
      previousDuration = musicDuration(transitionFrom);
      incomingOverlap = Math.min(transitionOverlap, previousDuration * .45, entry.duration * .45);
      previousLocal = Math.max(0, previousDuration - incomingOverlap + local);
    }

    return {
      item: entry.item,
      index: entry.index,
      cycleIndex: entry.cycleIndex,
      local,
      total: entry.end,
      duration: entry.duration,
      previous,
      previousDuration,
      incomingOverlap,
      previousLocal,
      slotRemaining: Math.max(0, entry.end - target),
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
    youtube?.sound(soundEnabled && timelinePosition(programItems(), programElapsed()).item?.videoAudio !== false);
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

  function liveMusicIdentity(value) {
    return JSON.stringify([
      value?.musicStartedAt || value?.startedAt || '',
      value?.audio?.music ?? .72,
      value?.audio?.crossfade ?? 2.5,
      String(value?.audio?.musicRepeat || 'shuffle'),
      (value?.music || []).map(track => [
        musicTrackKey(track),
        musicDuration(track),
        Number(track.gainDb) || 0,
        positive(track.fadeIn),
        positive(track.fadeOut)
      ])
    ]);
  }

  function transitionStamp(value) {
    const stamp = Date.parse(value || '');
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function resolvedLiveChannel(next, nowMs = synchronizedNowMs()) {
    const live = next?.live;
    const pending = next?.pendingLive;
    if (!live) return pending || null;
    if (!pending) return live;

    const programAt = transitionStamp(next.programTransitionAt || pending.programTransitionAt);
    const musicAt = transitionStamp(next.musicTransitionAt || pending.musicTransitionAt);
    const programReady = Boolean(programAt) && nowMs >= programAt;
    const musicReady = Boolean(musicAt) && nowMs >= musicAt;

    if (programReady && musicReady) return pending;
    if (!programReady && !musicReady) return live;

    const visual = programReady ? pending : live;
    const audio = musicReady ? pending : live;
    const mixed = {
      ...visual,
      music: Array.isArray(audio.music) ? audio.music : [],
      musicStartedAt: audio.musicStartedAt || audio.startedAt || visual.musicStartedAt || visual.startedAt,
      audio: {
        ...(visual.audio || {}),
        music: audio.audio?.music ?? visual.audio?.music,
        crossfade: audio.audio?.crossfade ?? visual.audio?.crossfade,
        musicRepeat: audio.audio?.musicRepeat ?? visual.audio?.musicRepeat
      }
    };
    mixed.revision = [
      visual.revision || visual.updatedAt || '',
      audio.revision || audio.updatedAt || '',
      programReady ? 'program-new' : 'program-old',
      musicReady ? 'music-new' : 'music-old'
    ].join(':');
    return mixed;
  }

  function adoptResolvedLive() {
    if (useDraft || !state) return false;
    const selected = resolvedLiveChannel(state);
    if (!selected) return false;
    const nextRevision = String(selected.revision || selected.updatedAt || state.updatedAt || '');
    if (nextRevision === revision) {
      channel = selected;
      return false;
    }

    const musicChanged = liveMusicIdentity(channel) !== liveMusicIdentity(selected);
    revision = nextRevision;
    channel = selected;
    currentProgramId = '';
    if (musicChanged) {
      currentMusicId = '';
      musicScheduleCache = null;
      musicLevel = duckTarget(null);
    }
    failedMedia.clear();
    renderTicker();
    syncProgram();
    return true;
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
    const selected = useDraft ? next.draft : resolvedLiveChannel(next);
    if (!selected) throw new Error('Broadcast state is empty.');
    const nextRevision = String(selected.revision || selected.updatedAt || next.updatedAt || '');
    state = next;
    if (nextRevision !== revision) {
      const musicChanged = liveMusicIdentity(channel) !== liveMusicIdentity(selected);
      revision = nextRevision;
      channel = selected;
      currentProgramId = '';
      if (musicChanged) {
        currentMusicId = '';
        musicScheduleCache = null;
        musicLevel = duckTarget(null);
      }
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

  function enableSoundFromGesture() {
    if (monitorMode || soundEnabled) return;
    setSoundState(true);
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, .05);
  }

  screen.addEventListener('pointerdown', enableSoundFromGesture);
  screen.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') enableSoundFromGesture();
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
    adoptResolvedLive();
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, deltaSeconds);
    reportPlayhead();
  }, 250);

  window.setInterval(() => {
    loadState().catch(() => {});
  }, 5000);

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
