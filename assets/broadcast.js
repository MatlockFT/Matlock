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
  const image = root.querySelector('[data-mfc-image]');
  const video = root.querySelector('[data-mfc-video]');
  const panel = root.querySelector('[data-mfc-panel]');
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
  const youtubeSlots = new Map();
  let youtubeApiPromise = null;
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

  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { previousReady?.(); } catch {}
        if (window.YT?.Player) resolve(window.YT);
        else reject(new Error('YouTube player API did not initialize.'));
      };
      let script = document.querySelector('script[data-mfc-youtube-api]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.mfcYoutubeApi = 'true';
        script.onerror = () => reject(new Error('Could not load the YouTube player API.'));
        document.head.append(script);
      }
      window.setTimeout(() => {
        if (window.YT?.Player) resolve(window.YT);
      }, 2500);
    });
    return youtubeApiPromise;
  }

  function youtubeSlotFor(element) {
    if (youtubeSlots.has(element)) return youtubeSlots.get(element);
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'fixed';
    host.style.width = '200px';
    host.style.height = '200px';
    host.style.left = '-10000px';
    host.style.top = '-10000px';
    host.style.pointerEvents = 'none';
    document.body.append(host);
    const slot = {
      host,
      player: null,
      ready: false,
      videoId: '',
      desiredTime: 0,
      desiredVolume: 0,
      desiredPlay: false,
      loadingId: ''
    };
    youtubeSlots.set(element, slot);
    return slot;
  }

  function applyYouTubeSlot(slot) {
    if (!slot?.ready || !slot.player) return;
    try { slot.player.setVolume(Math.round(clamp(slot.desiredVolume, 0, 1) * 100)); } catch {}
    try {
      const current = Number(slot.player.getCurrentTime?.());
      if (!Number.isFinite(current) || Math.abs(current - slot.desiredTime) > 1.2) {
        slot.player.seekTo(Math.max(0, slot.desiredTime), true);
      }
    } catch {}
    try {
      if (slot.desiredPlay) slot.player.playVideo();
      else slot.player.pauseVideo();
    } catch {}
  }

  function prepareYouTubeSlot(element, videoId, targetTime) {
    const slot = youtubeSlotFor(element);
    slot.desiredTime = Math.max(0, Number(targetTime) || 0);
    if (slot.videoId === videoId && slot.player) {
      applyYouTubeSlot(slot);
      return slot;
    }
    slot.videoId = videoId;
    slot.ready = false;

    loadYouTubeApi().then(YT => {
      if (slot.videoId !== videoId) return;
      if (!slot.player) {
        slot.player = new YT.Player(slot.host, {
          width: '200',
          height: '200',
          videoId,
          playerVars: {
            controls: 0,
            playsinline: 1,
            rel: 0,
            origin: location.origin
          },
          events: {
            onReady: event => {
              slot.ready = true;
              slot.loadingId = videoId;
              try { event.target.cueVideoById({ videoId, startSeconds: slot.desiredTime }); } catch {}
              window.setTimeout(() => applyYouTubeSlot(slot), 80);
            },
            onError: () => {
              slot.ready = false;
            }
          }
        });
      } else {
        try {
          slot.player.cueVideoById({ videoId, startSeconds: slot.desiredTime });
          slot.ready = true;
          slot.loadingId = videoId;
          window.setTimeout(() => applyYouTubeSlot(slot), 80);
        } catch {}
      }
    }).catch(() => {});
    return slot;
  }

  function setSlotVolume(element, value) {
    const volume = clamp(value, 0, 1);
    if (element.dataset.youtube === 'true') {
      const slot = youtubeSlots.get(element);
      if (slot) {
        slot.desiredVolume = volume;
        applyYouTubeSlot(slot);
      }
    } else {
      element.volume = volume;
    }
  }

  function playSlot(element) {
    if (element.dataset.youtube === 'true') {
      const slot = youtubeSlots.get(element);
      if (slot) {
        slot.desiredPlay = true;
        applyYouTubeSlot(slot);
      }
    } else {
      element.play().catch(() => {});
    }
  }

  function pauseSlot(element) {
    element.pause();
    const slot = youtubeSlots.get(element);
    if (slot) {
      slot.desiredPlay = false;
      applyYouTubeSlot(slot);
    }
  }

  function fmt(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(value / 60);
    const s = value % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function programItems() {
    return Array.isArray(channel?.program) ? channel.program.filter(item => positive(item.duration) > 0) : [];
  }

  function musicItems() {
    return Array.isArray(channel?.music) ? channel.music.filter(item => item?.url && positive(item.duration) > 0) : [];
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
    video.hidden = !isVideo;
    image.hidden = !isImage;
    panel.classList.toggle('has-media', isVideo || isImage);
    eyebrow.hidden = isVideo || isImage;
    title.hidden = isVideo || isImage;
    bodyCopy.hidden = isVideo || isImage;
  }

  function renderProgramItem(item) {
    if (!item) {
      setMediaMode('headline');
      screen.dataset.kind = 'headline';
      header.textContent = 'YOUR FIGHT FORECAST';
      eyebrow.textContent = 'MATLOCK FIGHT CHANNEL';
      title.textContent = 'NO PROGRAMMING';
      bodyCopy.textContent = 'Add items in the broadcast control room.';
      nowNode.textContent = 'NOW: STANDBY';
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

    if (kind === 'image') {
      const url = String(item.mediaUrl || '');
      if (url && image.src !== new URL(url, location.href).href) image.src = url;
      image.alt = String(item.alt || item.title || 'MMA news image');
    }

    if (kind === 'video') {
      const url = String(item.mediaUrl || '');
      if (url && video.dataset.source !== url) {
        video.dataset.source = url;
        video.src = url;
        video.load();
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.volume = clamp(channel?.audio?.video ?? 1, 0, 1);
    }
  }

  function syncProgram() {
    const elapsed = rawElapsed();
    const position = timelinePosition(programItems(), elapsed);
    const item = position.item;
    const id = String(item?.id || `${position.index}`);
    if (id !== currentProgramId) {
      currentProgramId = id;
      renderProgramItem(item);
    }

    if (item) progressNode.textContent = `${fmt(position.local)} / ${fmt(item.duration)}`;
    else progressNode.textContent = '00:00 / 00:00';

    if (item?.type === 'video' && item.mediaUrl) {
      const duration = positive(item.duration);
      const target = duration > 0 ? Math.min(position.local, Math.max(0, duration - .08)) : position.local;
      if (Number.isFinite(video.duration) && Math.abs((video.currentTime || 0) - target) > .8) {
        try { video.currentTime = target; } catch {}
      }
      video.muted = !soundEnabled || item.videoAudio === false;
      video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }

    return { elapsed, position };
  }

  function dbGain(db) {
    const value = Number(db);
    if (!Number.isFinite(value)) return 1;
    return Math.pow(10, value / 20);
  }

  function duckTarget(programItem) {
    if (!programItem || programItem.type !== 'video' || programItem.videoAudio === false) return 1;
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
    const trackId = String(track.id || track.url);
    const youtubeId = String(track.youtubeId || youtubeVideoId(track.url) || '');

    if (youtubeId) {
      element.dataset.trackId = trackId;
      element.dataset.youtubeId = youtubeId;
      element.dataset.youtube = 'true';
      element.pause();
      prepareYouTubeSlot(element, youtubeId, targetTime);
      return;
    }

    if (element.dataset.youtube === 'true') {
      const slot = youtubeSlots.get(element);
      if (slot) {
        slot.desiredPlay = false;
        applyYouTubeSlot(slot);
      }
      delete element.dataset.youtube;
      delete element.dataset.youtubeId;
    }
    if (element.dataset.trackId !== trackId) {
      element.dataset.trackId = trackId;
      element.src = track.url;
      element.load();
    }
    if (Number.isFinite(element.duration) && Math.abs((element.currentTime || 0) - targetTime) > 1.1) {
      try { element.currentTime = Math.max(0, Math.min(targetTime, element.duration - .05)); } catch {}
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
    if (!Number.isFinite(musicLevel) || musicLevel <= 0) musicLevel = desiredDuck;
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
    if (!monitorMode) {
      try { localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off'); } catch {}
    }
    soundButton.textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
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
        const response = await fetch(`${url}${joiner}t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Broadcast state ${response.status}`);
        next = await response.json();
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!next) throw lastError || new Error('Broadcast state unavailable.');
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
      renderTicker();
      syncProgram();
    } else {
      channel = selected;
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
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
    currentProgramId = '';
    currentMusicId = '';
    renderTicker();
    syncProgram();
  });

  soundButton.addEventListener('click', () => {
    if (monitorMode) return;
    setSoundState(!soundEnabled);
    const { elapsed, position } = syncProgram();
    syncMusic(elapsed, position.item, .05);
  });

  void loadYouTubeApi();
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
