(() => {
  let apiPromise;
  function api() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('YouTube player timed out')), 15000);
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); previous?.(); resolve(); };
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timeout); reject(new Error('YouTube player could not load')); };
      document.head.append(script);
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }
  window.matlockYoutubePlayer = (container, { error, blocked, playing }) => {
    let player = null, ready = false, creating = false, desired = null, loadedId = '', generation = 0;
    let bufferingSince = 0, requestedAt = 0, lastPosition = null, lastPlay = 0, failed = false, autoplayBlocked = false;
    function failure() {
      if (!desired || failed) return;
      failed = true; error(desired.url); player?.pauseVideo?.();
    }
    function apply() {
      if (!ready || !player) return;
      if (!desired) { player.pauseVideo(); return; }
      if (failed) return;
      if (desired.muted) player.mute(); else player.unMute();
      player.setVolume(desired.volume);
      if (loadedId !== desired.id) {
        loadedId = desired.id; requestedAt = performance.now(); lastPlay = requestedAt;
        bufferingSince = 0; lastPosition = null;
        player.loadVideoById({ videoId: desired.id, startSeconds: desired.time });
      } else {
        const current = Number(player.getCurrentTime());
        // Resynchronize only drift or a loop boundary; do not repeatedly seek during buffering.
        const wrapped = lastPosition != null && desired.time < lastPosition - 1;
        if (wrapped || (player.getPlayerState() === 1 && Math.abs(current - desired.time) > 2)) player.seekTo(desired.time, true);
        if ([0, 2, 5].includes(player.getPlayerState()) && performance.now() - lastPlay > 2000) {
          player.playVideo(); lastPlay = performance.now();
        }
      }
      lastPosition = desired.time;
      if ((bufferingSince && performance.now() - bufferingSince > 20000)
          || (requestedAt && player.getPlayerState() !== 1 && performance.now() - requestedAt > 25000)) failure();
    }
    async function create() {
      if (creating || player || !desired) return;
      creating = true; const token = generation;
      try {
        await api();
        if (token !== generation || !desired) return;
        const host = document.createElement('div'); container.replaceChildren(host);
        player = new YT.Player(host, {
          host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
          playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => { ready = true; apply(); },
            onError: () => failure(),
            onAutoplayBlocked: () => {
              if (!desired || failed) return;
              // Fall back to muted playback, leaving a real button for a user gesture.
              desired.muted = true; player.mute();
              if (!autoplayBlocked) { autoplayBlocked = true; player.playVideo(); }
              blocked();
            },
            onStateChange: event => {
              if (!desired || failed) return;
              if (event.data === 3) { if (!bufferingSince) bufferingSince = performance.now(); }
              if (event.data === 1) { bufferingSince = 0; requestedAt = 0; playing(); }
            }
          }
        });
        player.getIframe?.()?.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      } catch { if (token === generation) failure(); }
      finally { creating = false; }
    }
    return {
      sync(value) {
        if (!desired || desired.id !== value.id) { failed = false; autoplayBlocked = false; requestedAt = performance.now(); bufferingSince = 0; }
        desired = value; if (!player) void create(); apply();
      },
      stop() {
        if (desired) generation++;
        desired = null; loadedId = ''; bufferingSince = 0; requestedAt = 0; failed = false; player?.pauseVideo?.();
      },
      sound(enabled) { if (desired) { desired.muted = !enabled; apply(); player?.playVideo?.(); } }
    };
  };
})();
