(() => {
  const root = document.querySelector("[data-live-page]");
  if (!root) return;

  const statusUrl = root.dataset.statusUrl;
  const player = root.querySelector("[data-live-player]");
  const screen = root.querySelector("[data-live-screen]");
  const stateWrap = root.querySelector(".live-page__status");
  const stateText = root.querySelector("[data-live-state]");
  const title = root.querySelector("[data-live-title]");
  const promotion = root.querySelector("[data-live-promotion]");
  const nowPlayingLabel = root.querySelector("[data-live-now-label]");
  const source = root.querySelector("[data-live-source]");
  const refresh = root.querySelector("[data-live-refresh]");
  const standbyTitle = root.querySelector("[data-live-standby-title]");
  const standbyCopy = root.querySelector("[data-live-standby-copy]");
  const embedFallback = root.querySelector("[data-live-embed-fallback]");
  const embedFallbackLink = root.querySelector("[data-live-embed-fallback-link]");
  const liveList = root.querySelector("[data-live-list]");
  const liveCount = root.querySelector("[data-live-count]");
  const liveSection = root.querySelector("[data-live-section]");
  const upcomingList = root.querySelector("[data-upcoming-list]");
  const upcomingCount = root.querySelector("[data-upcoming-count]");
  const replayArm = root.querySelector("[data-replay-arm]");
  const replaySave = root.querySelector("[data-replay-save]");
  const replayStatus = root.querySelector("[data-replay-status]");
  const replayControls = root.querySelector("[data-replay-controls]");
  const replayWindow = root.querySelector("[data-replay-window]");
  const replayFill = root.querySelector("[data-replay-fill]");
  const replayStartLabel = root.querySelector("[data-replay-start]");
  const replayEndLabel = root.querySelector("[data-replay-end]");
  const mediaPlay = root.querySelector("[data-media-play]");
  const mediaPlayIcon = root.querySelector("[data-media-play-icon]");
  const mediaMute = root.querySelector("[data-media-mute]");
  const mediaVolume = root.querySelector("[data-media-volume]");
  const mediaQuality = root.querySelector("[data-media-quality]");
  const mediaLive = root.querySelector("[data-media-live]");

  let currentVideoId = "";
  let busy = false;
  let lastData = null;
  let uiIdleTimer = 0;
  let replayStream = null;
  let replayRecorder = null;
  let replayChunks = [];
  let replayHeaderBlob = null;
  let replayStartedAt = 0;
  let replayMimeType = "";
  let replayHasAudio = false;
  let replayStopping = false;
  let replayUiTimer = 0;
  let ytPlayer = null;
  let ytApiPromise = null;
  let playerControlTimer = 0;
  let playbackHealthTimer = 0;
  let liveVerificationTimer = 0;
  let liveVerificationMisses = 0;
  let verifiedLiveVideoId = "";
  let liveDurationSample = null;
  const endedVideoSuppressions = new Map();
  let lastNonZeroVolume = 100;

  const UI_IDLE_DELAY = 5000;
  const REPLAY_BUFFER_MS = 15000;
  const REPLAY_CHUNK_MS = 1000;
  const ENDED_VIDEO_SUPPRESS_MS = 30 * 60 * 1000;
  const PLAYBACK_HEALTH_DELAY = 4500;

  const clearUiIdleTimer = () => {
    window.clearTimeout(uiIdleTimer);
    uiIdleTimer = 0;
  };

  const scheduleUiFade = () => {
    clearUiIdleTimer();
    if (!currentVideoId || document.hidden) return;

    uiIdleTimer = window.setTimeout(() => {
      if (currentVideoId && !document.hidden) root.classList.add("is-ui-idle");
    }, UI_IDLE_DELAY);
  };

  const revealUi = () => {
    root.classList.remove("is-ui-idle");
    scheduleUiFade();
  };

  const loadYouTubeApi = () => {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;

    ytApiPromise = new Promise((resolve, reject) => {
      const priorReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try {
          priorReady?.();
        } finally {
          resolve(window.YT);
        }
      };

      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (existing) {
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.addEventListener("error", reject, { once: true });
      document.head.append(script);
    });

    return ytApiPromise;
  };

  const setQualityLabel = (quality) => {
    if (!mediaQuality) return;

    const labels = {
      small: "240P",
      medium: "360P",
      large: "480P",
      hd720: "720P",
      hd1080: "1080P",
      highres: "HD+"
    };

    const label = labels[quality] || "AUTO";
    mediaQuality.textContent = label;
    mediaQuality.setAttribute(
      "aria-label",
      label === "AUTO"
        ? "YouTube playback quality is automatic"
        : `Current YouTube playback quality ${label}`
    );
    mediaQuality.title =
      label === "AUTO"
        ? "YouTube manages playback quality automatically"
        : `Current quality: ${label} · YouTube manages selection automatically`;
  };

  const pruneEndedVideoSuppressions = () => {
    const now = Date.now();
    for (const [videoId, expiresAt] of endedVideoSuppressions.entries()) {
      if (expiresAt <= now) endedVideoSuppressions.delete(videoId);
    }
  };

  const suppressEndedVideo = (videoId) => {
    if (!videoId) return;
    endedVideoSuppressions.set(videoId, Date.now() + ENDED_VIDEO_SUPPRESS_MS);
  };

  const isSuppressedEndedVideo = (videoId) => {
    pruneEndedVideoSuppressions();
    return Boolean(videoId && endedVideoSuppressions.has(videoId));
  };

  const clearPlaybackHealthCheck = () => {
    window.clearTimeout(playbackHealthTimer);
    playbackHealthTimer = 0;
  };

  const hideEmbedFallback = () => {
    clearPlaybackHealthCheck();
    if (embedFallback) embedFallback.hidden = true;
    root.classList.remove("has-embed-fallback");
  };

  const showEmbedFallback = (videoId, reason = "stuck") => {
    if (!videoId || videoId !== currentVideoId || screen?.dataset.state !== "live") return;

    clearPlaybackHealthCheck();
    const activeEvent = (lastData?.events || []).find(event => event.video_id === videoId);
    if (embedFallbackLink) {
      embedFallbackLink.href =
        activeEvent?.watch_url ||
        `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }
    if (embedFallback) embedFallback.hidden = false;
    root.classList.add("has-embed-fallback");
    console.warn("YouTube embedded playback unavailable", { videoId, reason });
  };

  const startPlaybackHealthCheck = (videoId) => {
    clearPlaybackHealthCheck();
    if (!videoId) return;

    playbackHealthTimer = window.setTimeout(() => {
      if (videoId !== currentVideoId || screen?.dataset.state !== "live") return;

      if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") {
        showEmbedFallback(videoId, "player-api-unavailable");
        return;
      }

      try {
        const state = ytPlayer.getPlayerState();
        const duration = Number(ytPlayer.getDuration?.() ?? 0);
        if ((state === -1 || state === 5 || state == null) && duration <= 0) {
          showEmbedFallback(videoId, "player-stuck-cued");
        }
      } catch {
        showEmbedFallback(videoId, "player-state-unavailable");
      }
    }, PLAYBACK_HEALTH_DELAY);
  };

  const stopLiveVerification = () => {
    window.clearInterval(liveVerificationTimer);
    liveVerificationTimer = 0;
    liveVerificationMisses = 0;
    liveDurationSample = null;
  };

  const verifyEmbeddedLiveState = () => {
    if (!ytPlayer || !currentVideoId || screen?.dataset.state !== "live") return;

    try {
      const state = ytPlayer.getPlayerState?.();
      let shouldSuppress = state === 0;

      if (!shouldSuppress) {
        const duration = Number(ytPlayer.getDuration?.() ?? 0);
        const now = Date.now();
        const prior =
          liveDurationSample &&
          liveDurationSample.videoId === currentVideoId
            ? liveDurationSample
            : null;

        if (prior && duration > 0 && now - prior.at >= 750) {
          if (duration > prior.duration + 0.25) {
            liveVerificationMisses = 0;
            verifiedLiveVideoId = currentVideoId;
            hideEmbedFallback();
          } else if (state === 1) {
            // A live broadcast's duration keeps increasing. If a supposedly
            // live video is actively playing but its duration stays fixed for
            // several samples, it is the archived replay of an ended stream.
            liveVerificationMisses += 1;
          }
        }

        if (duration > 0) {
          liveDurationSample = {
            videoId: currentVideoId,
            duration,
            at: now
          };
        }

        shouldSuppress = liveVerificationMisses >= 3;
      }

      if (!shouldSuppress) return;

      const endedVideoId = currentVideoId;
      suppressEndedVideo(endedVideoId);
      verifiedLiveVideoId = "";
      try {
        ytPlayer.pauseVideo?.();
      } catch {}
      const nextData = lastData
        ? {
            ...lastData,
            selected_event_id: null,
            events: (lastData.events || []).filter(
              (event) => event.video_id !== endedVideoId
            ),
            live_count: Math.max(
              0,
              Number(lastData.live_count || 0) - 1
            )
          }
        : { events: [], upcoming: [] };

      lastData = nextData;
      stopLiveVerification();

      if (nextData.events.length) {
        setPlayer(nextData.events[0]);
      } else {
        showStandby(nextData.upcoming || []);
      }

      renderLiveEvents(nextData.events || []);
    } catch (error) {
      console.warn("Unable to verify embedded YouTube live state", error);
    }
  };

  const startLiveVerification = () => {
    stopLiveVerification();
    liveVerificationTimer = window.setInterval(
      verifyEmbeddedLiveState,
      1500
    );
    window.setTimeout(verifyEmbeddedLiveState, 750);
  };

  const updateMediaControls = () => {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") return;

    try {
      const state = ytPlayer.getPlayerState();
      const playing = state === window.YT?.PlayerState?.PLAYING || state === 1;
      const muted = ytPlayer.isMuted?.() || false;
      const volume = Number(ytPlayer.getVolume?.() ?? 100);
      const current = Number(ytPlayer.getCurrentTime?.() ?? 0);
      const duration = Number(ytPlayer.getDuration?.() ?? 0);
      const liveGap = Math.max(0, duration - current);
      const atLiveEdge = duration > 0 && liveGap <= 4;

      if (mediaPlayIcon) mediaPlayIcon.textContent = playing ? "Ⅱ" : "▶";
      if (mediaPlay) {
        mediaPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
        mediaPlay.title = playing ? "Pause" : "Play";
      }

      const effectivelyMuted = muted || volume === 0;
      if (!effectivelyMuted && volume > 0) {
        lastNonZeroVolume = volume;
      }

      if (mediaMute) {
        mediaMute.classList.toggle("is-muted", effectivelyMuted);
        mediaMute.setAttribute("aria-label", effectivelyMuted ? "Unmute" : "Mute");
        mediaMute.title = effectivelyMuted ? "Unmute" : "Mute";
      }

      if (mediaVolume && document.activeElement !== mediaVolume) {
        mediaVolume.value = effectivelyMuted ? "0" : String(Math.round(volume));
      }

      mediaLive?.classList.toggle("is-live-edge", atLiveEdge);
      if (mediaLive) {
        mediaLive.title = atLiveEdge ? "At live edge" : "Jump to live";
        mediaLive.setAttribute("aria-label", atLiveEdge ? "At live edge" : "Jump to live");
      }
    } catch {
      // The player can be between iframe navigations while a stream changes.
    }
  };

  const startPlayerControlSync = () => {
    window.clearInterval(playerControlTimer);
    playerControlTimer = window.setInterval(updateMediaControls, 1000);
    updateMediaControls();
  };

  const attachYouTubePlayerApi = async () => {
    if (!player?.src || !currentVideoId) return null;

    try {
      await loadYouTubeApi();

      if (ytPlayer?.destroy) {
        try {
          ytPlayer.destroy();
        } catch {
          // Existing wrapper may already have been replaced by iframe navigation.
        }
      }

      ytPlayer = new YT.Player("live-youtube-player", {
        events: {
          onReady: () => {
            setQualityLabel("auto");
            startPlayerControlSync();
            startLiveVerification();

            const activeEvent = findEventByVideo(lastData?.events || [], currentVideoId);
            const readyState = ytPlayer.getPlayerState?.();
            if (readyState !== 0 && shouldAutoplayEvent(activeEvent)) {
              try {
                ytPlayer.mute?.();
                ytPlayer.playVideo?.();
              } catch {}
            }

            updateMediaControls();
            verifyEmbeddedLiveState();
          },
          onStateChange: (event) => {
            const nextState = Number(event?.data);
            if (nextState === 1 || nextState === 2 || nextState === 3) {
              hideEmbedFallback();
            }
            updateMediaControls();
            verifyEmbeddedLiveState();
          },
          onPlaybackQualityChange: (event) => {
            setQualityLabel(event?.data || "auto");
            updateMediaControls();
          },
          onError: (event) => {
            updateMediaControls();
            showEmbedFallback(currentVideoId, `youtube-error-${event?.data ?? "unknown"}`);
          }
        }
      });

      return ytPlayer;
    } catch (error) {
      console.warn("YouTube player controls unavailable", error);
      ytPlayer = null;
      return null;
    }
  };

  const withYouTubePlayer = async (callback) => {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== "function") {
      await attachYouTubePlayerApi();
    }
    if (!ytPlayer) return;
    try {
      callback(ytPlayer);
      window.setTimeout(updateMediaControls, 80);
    } catch (error) {
      console.warn("YouTube player command failed", error);
    }
  };

  const togglePlayback = () => {
    revealUi();
    withYouTubePlayer((api) => {
      const state = api.getPlayerState();
      if (state === 1 || state === 3) api.pauseVideo();
      else api.playVideo();
    });
  };

  const toggleMute = () => {
    revealUi();
    withYouTubePlayer((api) => {
      const currentVolume = Number(api.getVolume?.() ?? 100);
      const muted = api.isMuted?.() || currentVolume === 0;

      if (muted) {
        const restoreVolume = Math.max(1, lastNonZeroVolume || 100);
        api.setVolume(restoreVolume);
        api.unMute();
        if (mediaVolume) mediaVolume.value = String(Math.round(restoreVolume));
      } else {
        if (currentVolume > 0) lastNonZeroVolume = currentVolume;
        api.mute();
        if (mediaVolume) mediaVolume.value = "0";
      }
    });
  };

  const setPlayerVolume = (value) => {
    revealUi();
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));

    if (normalized > 0) {
      lastNonZeroVolume = normalized;
      mediaMute?.classList.remove("is-muted");
    } else {
      mediaMute?.classList.add("is-muted");
    }

    withYouTubePlayer((api) => {
      api.setVolume(normalized);
      if (normalized === 0) api.mute();
      else if (api.isMuted()) api.unMute();
    });
  };

  const jumpToLive = () => {
    revealUi();
    withYouTubePlayer((api) => {
      const duration = Number(api.getDuration?.() ?? 0);
      if (duration > 0) {
        api.seekTo(Math.max(0, duration - .15), true);
        api.playVideo();
      }
    });
  };

  const setReplayStatus = (message) => {
    if (replayStatus) replayStatus.textContent = message;
  };

  const settleReplayCaptureFrame = async () => {
    root.classList.add("is-replay-armed");

    // Size the target before capture begins so the entire 16:9 frame fits
    // inside the visible browser viewport. This prevents clipped/offscreen
    // portions from becoming black pixels in the recorded stream.
    const viewportHeight =
      window.visualViewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight;
    const currentWidth = screen?.getBoundingClientRect().width || 0;
    const availableHeight = Math.max(240, viewportHeight - 16);
    const widthThatFitsHeight = availableHeight * (16 / 9);
    const captureWidth = Math.max(
      320,
      Math.min(currentWidth || widthThatFitsHeight, widthThatFitsHeight)
    );

    root.style.setProperty(
      "--replay-capture-width",
      `${Math.floor(captureWidth)}px`
    );

    // Put the target at the top of the viewport before capture begins, then
    // let sticky positioning keep it there while the rest of the page scrolls.
    screen?.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "auto"
    });

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  };

  const releaseReplayCaptureFrame = () => {
    root.classList.remove("is-replay-armed");
    root.style.removeProperty("--replay-capture-width");
  };

  const replaySupported = () => {
    const hasElementCapture =
      "RestrictionTarget" in window &&
      typeof window.RestrictionTarget?.fromElement === "function";
    const hasRegionCapture =
      "CropTarget" in window &&
      typeof window.CropTarget?.fromElement === "function";

    return (
      window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getDisplayMedia) &&
      "MediaRecorder" in window &&
      (hasElementCapture || hasRegionCapture)
    );
  };

  const chooseReplayMimeType = (hasAudio) => {
    const withAudio = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc3.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.4D401F,mp4a.40.2"
    ];
    const videoOnly = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc3.42E01E",
      "video/mp4;codecs=avc1.4D401F"
    ];
    const types = hasAudio ? withAudio : videoOnly;

    return types.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  };

  const recorderMimeIsXCompatible = (mimeType, hasAudio) => {
    const normalized = String(mimeType || "").toLowerCase();
    const hasAvc = normalized.includes("avc1") || normalized.includes("avc3");
    const hasAac = normalized.includes("mp4a.40.2") || normalized.includes("aac");
    return normalized.includes("video/mp4") && hasAvc && (!hasAudio || hasAac);
  };

  const restrictCaptureToPlayer = async (videoTrack) => {
    if (
      "RestrictionTarget" in window &&
      typeof window.RestrictionTarget?.fromElement === "function" &&
      typeof videoTrack.restrictTo === "function"
    ) {
      const restrictionTarget = await RestrictionTarget.fromElement(screen);
      await videoTrack.restrictTo(restrictionTarget);
      return "element";
    }

    if (
      "CropTarget" in window &&
      typeof window.CropTarget?.fromElement === "function" &&
      typeof videoTrack.cropTo === "function"
    ) {
      const cropTarget = await CropTarget.fromElement(screen);
      await videoTrack.cropTo(cropTarget);
      return "region";
    }

    throw new Error("Player-only capture is unavailable in this browser.");
  };

  const updateReplayWindow = () => {
    const recording = replayRecorder?.state === "recording";
    const elapsedMs = recording
      ? Math.max(0, performance.now() - replayStartedAt)
      : 0;
    const bufferedMs = Math.min(REPLAY_BUFFER_MS, elapsedMs);
    const seconds = bufferedMs / 1000;
    const progress = Math.max(0, Math.min(1, bufferedMs / REPLAY_BUFFER_MS));
    const ready = bufferedMs >= REPLAY_BUFFER_MS;

    replayControls?.classList.toggle("is-buffering", recording);
    replayControls?.classList.toggle("is-ready", ready);

    if (replayFill) {
      replayFill.style.width = `${(progress * 100).toFixed(1)}%`;
    }

    if (replayStartLabel) {
      replayStartLabel.textContent = ready
        ? "−15s"
        : bufferedMs > 0
          ? `−${Math.max(1, Math.floor(seconds))}s`
          : "0s";
    }
    if (replayEndLabel) replayEndLabel.textContent = "NOW";
  };

  const startReplayUiTimer = () => {
    window.clearInterval(replayUiTimer);
    replayUiTimer = window.setInterval(updateReplayWindow, 200);
    updateReplayWindow();
  };

  const stopReplayUiTimer = () => {
    window.clearInterval(replayUiTimer);
    replayUiTimer = 0;
    replayControls?.classList.remove("is-buffering", "is-ready");
    if (replayFill) replayFill.style.width = "0%";
    if (replayStartLabel) replayStartLabel.textContent = "0s";
    if (replayEndLabel) replayEndLabel.textContent = "NOW";
  };

  const resetReplayUi = (status = "Off") => {
    replayArm?.classList.remove("is-buffering");
    if (replayArm) {
      replayArm.disabled = false;
      replayArm.setAttribute("aria-pressed", "false");
      replayArm.setAttribute("aria-label", "Arm 15-second replay buffer");
      replayArm.title = "Arm 15-second replay buffer";
    }
    if (replaySave) replaySave.disabled = true;
    setReplayStatus(status);
  };

  const stopReplayBuffer = (status = "Off") => {
    if (replayStopping) return;
    replayStopping = true;

    const recorder = replayRecorder;
    const stream = replayStream;

    replayRecorder = null;
    replayStream = null;
    replayChunks = [];
    replayHeaderBlob = null;
    replayStartedAt = 0;
    replayMimeType = "";
    replayHasAudio = false;
    stopReplayUiTimer();
    releaseReplayCaptureFrame();

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder is already stopping.
      }
    }

    stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Track already ended.
      }
    });

    resetReplayUi(status);
    replayStopping = false;
  };

  const updateReplayReadyState = () => {
    if (!replayRecorder || replayRecorder.state !== "recording") return;

    updateReplayWindow();

    const bufferedMs = Math.min(
      REPLAY_BUFFER_MS,
      Math.max(0, performance.now() - replayStartedAt)
    );

    if (replaySave) replaySave.disabled = bufferedMs < 2000;
    setReplayStatus(
      bufferedMs >= REPLAY_BUFFER_MS
        ? "15s ready"
        : `${Math.max(1, Math.ceil(bufferedMs / 1000))}s buffering`
    );
  };

  const pruneReplayChunks = (now = performance.now()) => {
    const cutoff = now - REPLAY_BUFFER_MS - (REPLAY_CHUNK_MS * 2);
    replayChunks = replayChunks.filter((chunk) => chunk.endedAt >= cutoff);
  };

  const armReplayBuffer = async () => {
    revealUi();

    if (replayRecorder?.state === "recording") {
      stopReplayBuffer("Off");
      return;
    }

    if (!currentVideoId || screen?.dataset.state !== "live") {
      setReplayStatus("No live video");
      return;
    }

    if (!replaySupported()) {
      setReplayStatus("Desktop Chrome/Edge required");
      return;
    }

    if (replayArm) replayArm.disabled = true;
    setReplayStatus("Choose This Tab + tab audio");

    let stream = null;

    try {
      await settleReplayCaptureFrame();
      const supportedCaptureConstraints =
        navigator.mediaDevices.getSupportedConstraints?.() || {};
      const videoConstraints = {
        frameRate: { ideal: 30, max: 30 }
      };

      if (supportedCaptureConstraints.cursor) {
        videoConstraints.cursor = "never";
      }

      stream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "include"
      });

      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) {
        throw new Error("No capture video track was returned.");
      }

      try {
        videoTrack.contentHint = "motion";
      } catch {
        // Optional optimization only.
      }

      try {
        const trackConstraints = {
          frameRate: { max: 30 }
        };
        if (supportedCaptureConstraints.cursor) {
          trackConstraints.cursor = "never";
        }
        await videoTrack.applyConstraints(trackConstraints);
      } catch {
        // Capture can continue if an optional constraint is unavailable.
      }

      const captureMode = await restrictCaptureToPlayer(videoTrack);

      // Give Chromium a rendering turn to apply the restriction/crop, then
      // verify that the returned track actually resembles the 16:9 player.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const captureSettings = videoTrack.getSettings?.() || {};
      const targetRect = screen.getBoundingClientRect();
      const targetRatio = targetRect.width / Math.max(1, targetRect.height);
      const captureRatio =
        captureSettings.width && captureSettings.height
          ? captureSettings.width / captureSettings.height
          : targetRatio;

      if (
        !Number.isFinite(captureRatio) ||
        Math.abs(captureRatio - targetRatio) > 0.08
      ) {
        throw new Error("Player-only capture verification failed.");
      }

      replayHasAudio = stream.getAudioTracks().length > 0;
      replayMimeType = chooseReplayMimeType(replayHasAudio);
      if (!replayMimeType) {
        throw new Error(
          replayHasAudio
            ? "H.264/AAC MP4 recording is unavailable in this browser."
            : "H.264 MP4 recording is unavailable in this browser."
        );
      }

      const recorderOptions = {
        mimeType: replayMimeType,
        videoBitsPerSecond: 5000000,
        audioBitsPerSecond: 128000,
        videoKeyFrameIntervalDuration: 1000
      };

      const recorder = new MediaRecorder(stream, recorderOptions);
      if (!recorderMimeIsXCompatible(recorder.mimeType, replayHasAudio)) {
        throw new Error("Recorder did not honor the H.264/AAC MP4 request.");
      }
      replayMimeType = recorder.mimeType;
      replayStream = stream;
      replayRecorder = recorder;
      replayChunks = [];
      replayHeaderBlob = null;
      replayStartedAt = performance.now();

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data || event.data.size <= 0) return;
        const now = performance.now();
        if (!replayHeaderBlob) replayHeaderBlob = event.data;
        replayChunks.push({ blob: event.data, endedAt: now });
        pruneReplayChunks(now);
        updateReplayReadyState();
      });

      recorder.addEventListener("stop", () => {
        if (replayRecorder === recorder) stopReplayBuffer("Off");
      });

      for (const track of stream.getTracks()) {
        track.addEventListener("ended", () => {
          if (replayStream === stream) stopReplayBuffer("Buffer stopped");
        }, { once: true });
      }

      recorder.start(REPLAY_CHUNK_MS);
      startReplayUiTimer();

      if (replayArm) {
        replayArm.disabled = false;
        replayArm.setAttribute("aria-pressed", "true");
        replayArm.setAttribute("aria-label", "Stop 15-second replay buffer");
        replayArm.title = "Stop 15-second replay buffer";
        replayArm.classList.add("is-buffering");
      }

      const captureLabel = captureMode === "element" ? "Player capture" : "Player crop";
      setReplayStatus(
        replayHasAudio
          ? `${captureLabel} · H.264/AAC`
          : `${captureLabel} · H.264 video only`
      );
      updateReplayReadyState();
      scheduleUiFade();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      releaseReplayCaptureFrame();
      console.warn("Replay buffer unavailable", error);

      const denied = error?.name === "NotAllowedError";
      const cropFailure = !denied && /crop|restrict|current tab|player-only|verification/i.test(String(error?.message || ""));
      setReplayStatus(
        denied
          ? "Capture cancelled"
          : cropFailure
            ? "Player-only capture failed"
            : /H\.264|AAC|Recorder did not honor/i.test(String(error?.message || ""))
              ? "H.264/AAC unavailable"
              : /MP4/i.test(String(error?.message || ""))
                ? "MP4 capture unsupported"
                : "Replay unavailable"
      );

      if (replayArm) replayArm.disabled = false;
    }
  };

  const flushReplayRecorder = () =>
    new Promise((resolve) => {
      if (!replayRecorder || replayRecorder.state !== "recording") {
        resolve();
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };

      const timeoutId = window.setTimeout(finish, 350);
      replayRecorder.addEventListener("dataavailable", finish, { once: true });

      try {
        replayRecorder.requestData();
      } catch {
        finish();
      }
    });

  const readUint32 = (bytes, offset) =>
    new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);

  const writeUint32 = (bytes, offset, value) =>
    new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value >>> 0);

  const readUint64 = (bytes, offset) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    return (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
  };

  const writeUint64 = (bytes, offset, value) => {
    const normalized = BigInt(value);
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    view.setUint32(0, Number((normalized >> 32n) & 0xffffffffn));
    view.setUint32(4, Number(normalized & 0xffffffffn));
  };

  const mp4TypeAt = (bytes, offset) =>
    String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );

  const parseMp4Boxes = (bytes, start = 0, end = bytes.length) => {
    const boxes = [];
    let offset = start;

    while (offset + 8 <= end) {
      let size = readUint32(bytes, offset);
      const type = mp4TypeAt(bytes, offset + 4);
      let headerSize = 8;

      if (size === 1) {
        if (offset + 16 > end) break;
        const largeSize = readUint64(bytes, offset + 8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
        size = Number(largeSize);
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }

      if (size < headerSize || offset + size > end) break;

      boxes.push({
        type,
        offset,
        size,
        headerSize,
        dataStart: offset + headerSize,
        end: offset + size
      });

      offset += size;
    }

    return boxes;
  };

  const findMp4BoxStart = (bytes, wantedType) => {
    const chars = [...wantedType].map((char) => char.charCodeAt(0));

    for (let typeOffset = 4; typeOffset <= bytes.length - 4; typeOffset += 1) {
      if (
        bytes[typeOffset] !== chars[0] ||
        bytes[typeOffset + 1] !== chars[1] ||
        bytes[typeOffset + 2] !== chars[2] ||
        bytes[typeOffset + 3] !== chars[3]
      ) continue;

      const start = typeOffset - 4;
      if (start < 0 || start + 8 > bytes.length) continue;

      const size = readUint32(bytes, start);
      if (size >= 8 && start + size <= bytes.length) return start;

      if (size === 1 && start + 16 <= bytes.length) {
        const largeSize = readUint64(bytes, start + 8);
        if (
          largeSize >= 16n &&
          largeSize <= BigInt(bytes.length - start)
        ) return start;
      }
    }

    return -1;
  };

  const concatUint8Arrays = (arrays) => {
    const total = arrays.reduce((sum, array) => sum + array.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;

    for (const array of arrays) {
      merged.set(array, offset);
      offset += array.byteLength;
    }

    return merged;
  };

  const rebaseMp4Fragments = (payload) => {
    const baseDecodeTimes = new Map();
    let sequence = 1;

    for (const moof of parseMp4Boxes(payload)) {
      if (moof.type !== "moof") continue;

      const moofChildren = parseMp4Boxes(payload, moof.dataStart, moof.end);

      for (const child of moofChildren) {
        if (child.type === "mfhd" && child.dataStart + 8 <= child.end) {
          writeUint32(payload, child.dataStart + 4, sequence);
          sequence += 1;
        }

        if (child.type !== "traf") continue;

        const trafChildren = parseMp4Boxes(payload, child.dataStart, child.end);
        const tfhd = trafChildren.find((box) => box.type === "tfhd");
        const tfdt = trafChildren.find((box) => box.type === "tfdt");

        if (!tfhd || !tfdt || tfhd.dataStart + 8 > tfhd.end) continue;

        const trackId = readUint32(payload, tfhd.dataStart + 4);
        const version = payload[tfdt.dataStart];
        const valueOffset = tfdt.dataStart + 4;

        if (version === 1) {
          if (valueOffset + 8 > tfdt.end) continue;
          const value = readUint64(payload, valueOffset);
          if (!baseDecodeTimes.has(trackId)) baseDecodeTimes.set(trackId, value);
          writeUint64(payload, valueOffset, value - baseDecodeTimes.get(trackId));
        } else {
          if (valueOffset + 4 > tfdt.end) continue;
          const value = BigInt(readUint32(payload, valueOffset));
          if (!baseDecodeTimes.has(trackId)) baseDecodeTimes.set(trackId, value);
          const rebased = value - baseDecodeTimes.get(trackId);
          writeUint32(payload, valueOffset, Number(rebased));
        }
      }
    }

    return payload;
  };

  const bytesContainAscii = (bytes, text) => {
    const pattern = [...text].map((char) => char.charCodeAt(0));
    outer:
    for (let index = 0; index <= bytes.length - pattern.length; index += 1) {
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (bytes[index + offset] !== pattern[offset]) continue outer;
      }
      return true;
    }
    return false;
  };

  const buildRollingMp4 = async (chunks) => {
    if (!replayHeaderBlob) {
      throw new Error("Replay MP4 initialization segment is not available yet.");
    }

    const headerSource = new Uint8Array(await replayHeaderBlob.arrayBuffer());
    const headerHasAvc =
      bytesContainAscii(headerSource, "avc1") ||
      bytesContainAscii(headerSource, "avc3");
    const headerHasAac = bytesContainAscii(headerSource, "mp4a");

    if (!headerHasAvc || (replayHasAudio && !headerHasAac)) {
      throw new Error("Replay codec verification failed: H.264/AAC not present.");
    }
    const firstHeaderMoof = findMp4BoxStart(headerSource, "moof");
    const header =
      firstHeaderMoof > 0
        ? headerSource.slice(0, firstHeaderMoof)
        : headerSource;

    const chunkArrays = await Promise.all(
      chunks.map(async (chunk) => new Uint8Array(await chunk.blob.arrayBuffer()))
    );
    const combined = concatUint8Arrays(chunkArrays);
    const firstMoof = findMp4BoxStart(combined, "moof");

    if (firstMoof < 0) {
      throw new Error("No complete MP4 fragment exists in the replay window.");
    }

    const payload = rebaseMp4Fragments(combined.slice(firstMoof));
    return new Blob([header, payload], { type: "video/mp4" });
  };

  const saveReplayBuffer = async () => {
    revealUi();

    if (!replayRecorder || replayRecorder.state !== "recording") {
      setReplayStatus("Arm buffer first");
      return;
    }

    if (replaySave) replaySave.disabled = true;
    setReplayStatus("Preparing replay…");

    await flushReplayRecorder();

    const now = performance.now();
    const cutoff = now - REPLAY_BUFFER_MS;
    pruneReplayChunks(now);

    let startIndex = replayChunks.findIndex((chunk) => chunk.endedAt >= cutoff);
    if (startIndex < 0) startIndex = Math.max(0, replayChunks.length - 1);
    if (startIndex > 0) startIndex -= 1;

    const selected = replayChunks.slice(startIndex);
    if (!selected.length) {
      updateReplayReadyState();
      setReplayStatus("Buffer empty");
      return;
    }

    let blob;
    try {
      blob = await buildRollingMp4(selected);
    } catch (error) {
      console.warn("Replay assembly failed", error);
      updateReplayReadyState();
      setReplayStatus("Replay assembly failed");
      return;
    }

    const extension = "mp4";
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const filename = `mma-matlock-replay-${stamp}.${extension}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);

    setReplayStatus("Saved −15s → NOW");
    window.setTimeout(updateReplayReadyState, 1800);
  };

  const shouldAutoplayEvent = (event) =>
    Boolean(
      event &&
      event.api_verified === true &&
      event.status === "live" &&
      event.stale !== true
    );

  const embedUrl = (videoId, autoplay = false) => {
    const params = new URLSearchParams({
      autoplay: autoplay ? "1" : "0",
      mute: autoplay ? "1" : "0",
      playsinline: "1",
      controls: "1",
      fs: "1",
      iv_load_policy: "3",
      disablekb: "0",
      rel: "0",
      enablejsapi: "1",
      origin: window.location.origin
    });
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  };

  const formatSchedule = (value) => {
    if (!value) return "Time TBD";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Time TBD";

    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(parsed);
  };

  const findEventById = (events, eventId) =>
    events.find((event) => event.event_id === eventId);

  const findEventByVideo = (events, videoId) =>
    events.find((event) => event.video_id === videoId);

  const renderLiveEvents = (events) => {
    if (!liveList || !liveCount || !liveSection) return;

    const active = Array.isArray(events) ? events : [];
    const others = currentVideoId
      ? active.filter(event => event.video_id !== currentVideoId)
      : active;

    liveSection.hidden = others.length === 0;
    liveCount.textContent =
      others.length === 1 ? "1 other live" : `${others.length} other live`;

    if (!others.length) {
      liveList.innerHTML = "";
      return;
    }

    liveList.innerHTML = "";

    for (const event of others) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-page__row live-page__row--button";
      if (event.video_id === currentVideoId) button.classList.add("is-playing");

      const state = document.createElement("span");
      state.className = "live-page__row-state";
      state.textContent = event.video_id === currentVideoId ? "Playing" : "Live";

      const copy = document.createElement("div");
      copy.className = "live-page__row-copy";

      const name = document.createElement("strong");
      name.textContent = event.title || "Live MMA";

      const meta = document.createElement("span");
      meta.className = "live-page__row-meta";
      const viewers = event.concurrent_viewers
        ? ` · ${Number(event.concurrent_viewers).toLocaleString()} watching`
        : "";
      meta.textContent =
        `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}${viewers}`;

      const action = document.createElement("span");
      action.className = "live-page__row-action";
      action.textContent = event.video_id === currentVideoId ? "Now" : "Watch";

      copy.append(name, meta);
      button.append(state, copy, action);
      button.addEventListener("click", () => {
        revealUi();
        setPlayer(event);
      });
      liveList.append(button);
    }
  };

  const renderUpcoming = (events) => {
    if (!upcomingList || !upcomingCount) return;

    const scheduled = Array.isArray(events) ? events : [];
    upcomingCount.textContent =
      scheduled.length === 1 ? "1 upcoming" : `${scheduled.length} upcoming`;

    if (!scheduled.length) {
      upcomingList.innerHTML =
        '<div class="live-page__empty"><strong>No scheduled broadcasts yet.</strong><span>Some promotions publish their stream shortly before the event.</span></div>';
      return;
    }

    upcomingList.innerHTML = "";

    for (const event of scheduled.slice(0, 12)) {
      const row = document.createElement("a");
      row.className = "live-page__row";
      row.href = event.watch_url || `https://www.youtube.com/watch?v=${event.video_id}`;
      row.target = "_blank";
      row.rel = "noopener noreferrer";

      const time = document.createElement("span");
      time.className = "live-page__row-state";
      time.textContent = formatSchedule(event.scheduled_start_time);

      const copy = document.createElement("div");
      copy.className = "live-page__row-copy";

      const name = document.createElement("strong");
      name.textContent = event.title || "Upcoming MMA";

      const meta = document.createElement("span");
      meta.className = "live-page__row-meta";
      meta.textContent =
        `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}`;

      const action = document.createElement("span");
      action.className = "live-page__row-action";
      action.textContent = "↗";

      copy.append(name, meta);
      row.append(time, copy, action);
      upcomingList.append(row);
    }
  };

  const setPlayer = (event) => {
    if (!event || !event.video_id || isSuppressedEndedVideo(event.video_id)) return;

    const previousVideoId = currentVideoId;
    const changingVideo = previousVideoId !== event.video_id;
    currentVideoId = event.video_id;
    if (changingVideo) {
      verifiedLiveVideoId = "";
      liveDurationSample = null;
    }
    root.classList.remove("is-offline");
    root.classList.add("is-live");
    hideEmbedFallback();
    screen.dataset.state = "live";
    stateWrap?.classList.add("is-live");
    if (stateText) stateText.textContent = event.stale ? "Live status delayed" : "Live now";
    if (nowPlayingLabel) nowPlayingLabel.textContent = "Now playing";
    title.textContent = event.title || "Live MMA";
    promotion.textContent =
      `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}`;

    source.href = event.watch_url || `https://www.youtube.com/watch?v=${event.video_id}`;
    source.hidden = false;

    if (changingVideo && ytPlayer && typeof ytPlayer.loadVideoById === "function") {
      stopLiveVerification();
      try {
        if (shouldAutoplayEvent(event)) ytPlayer.mute?.();
        ytPlayer.loadVideoById(event.video_id);
        startLiveVerification();
        window.setTimeout(updateMediaControls, 120);
      } catch (error) {
        console.warn("Unable to switch YouTube live stream in-place", error);
        ytPlayer = null;
        window.clearInterval(playerControlTimer);
        playerControlTimer = 0;
        stopLiveVerification();
        player.src = embedUrl(event.video_id, shouldAutoplayEvent(event));
        player.addEventListener("load", () => attachYouTubePlayerApi(), { once: true });
      }
    } else if (!player.getAttribute("src") || !player.src.includes(event.video_id)) {
      try {
        ytPlayer?.destroy?.();
      } catch {}
      ytPlayer = null;
      window.clearInterval(playerControlTimer);
      playerControlTimer = 0;
      stopLiveVerification();
      player.src = embedUrl(event.video_id, shouldAutoplayEvent(event));
      player.addEventListener("load", () => attachYouTubePlayerApi(), { once: true });
    } else if (!ytPlayer) {
      attachYouTubePlayerApi();
    }

    startPlaybackHealthCheck(event.video_id);
    scheduleUiFade();
    if (liveSection) liveSection.hidden = true;
    renderLiveEvents(lastData?.events || []);
  };

  const showStandby = (upcoming) => {
    root.classList.remove("is-live");
    root.classList.add("is-offline");
    hideEmbedFallback();
    screen.dataset.state = "offline";
    stateWrap?.classList.remove("is-live");
    if (stateText) stateText.textContent = "No fights live";
    if (nowPlayingLabel) nowPlayingLabel.textContent = "Status";
    title.textContent = "No fights live right now";
    const upcomingCountValue = Array.isArray(upcoming) ? upcoming.length : 0;
    promotion.textContent = upcomingCountValue
      ? `${upcomingCountValue} upcoming public broadcast${upcomingCountValue === 1 ? "" : "s"}`
      : "No scheduled public broadcasts yet";
    source.hidden = true;

    if (player.getAttribute("src")) player.removeAttribute("src");
    currentVideoId = "";
    verifiedLiveVideoId = "";
    window.clearInterval(playerControlTimer);
    playerControlTimer = 0;
    stopLiveVerification();
    try {
      ytPlayer?.destroy?.();
    } catch {}
    ytPlayer = null;
    stopReplayBuffer("Off");
    clearUiIdleTimer();
    root.classList.remove("is-ui-idle");

    const next = Array.isArray(upcoming) ? upcoming[0] : null;
    if (next) {
      standbyTitle.textContent = "Next broadcast";
      standbyCopy.textContent =
        `${next.short_name || next.promotion || "MMA"} · ${formatSchedule(next.scheduled_start_time)}`;
    } else {
      standbyTitle.textContent = "No fights live right now";
      standbyCopy.textContent = "The next public broadcast will appear here automatically.";
    }

    renderLiveEvents(lastData?.events || []);
  };

  const applyData = (data) => {
    const events = (Array.isArray(data.events) ? data.events : [])
      .filter(event => !isSuppressedEndedVideo(event?.video_id));
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];
    lastData = {
      ...data,
      events,
      live_count: events.length,
      selected_event_id: events.some(event => event.event_id === data.selected_event_id)
        ? data.selected_event_id
        : null
    };

    renderUpcoming(upcoming);

    const currentStillLive = currentVideoId
      ? findEventByVideo(events, currentVideoId)
      : null;

    if (currentStillLive) {
      setPlayer(currentStillLive);
    } else {
      const selected =
        findEventById(events, data.selected_event_id) ||
        events[0] ||
        null;

      if (selected) setPlayer(selected);
      else showStandby(upcoming);
    }

    renderLiveEvents(events);
  };

  const loadStatus = async () => {
    if (busy) return;
    busy = true;

    try {
      const separator = statusUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${statusUrl}${separator}t=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
      applyData(await response.json());
    } catch (error) {
      console.warn("Live MMA status unavailable", error);
      if (stateText) {
        stateText.textContent = currentVideoId
          ? "Live status delayed"
          : "Updates temporarily unavailable";
      }
    } finally {
      busy = false;
    }
  };

  mediaPlay?.addEventListener("click", togglePlayback);
  mediaMute?.addEventListener("click", toggleMute);
  mediaVolume?.addEventListener("input", (event) => setPlayerVolume(event.target.value));
  mediaLive?.addEventListener("click", jumpToLive);
  replayArm?.addEventListener("click", armReplayBuffer);
  replaySave?.addEventListener("click", saveReplayBuffer);
  refresh?.addEventListener("click", loadStatus);
  window.addEventListener("online", loadStatus);

  const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
  for (const eventName of activityEvents) {
    window.addEventListener(eventName, revealUi, { passive: true });
  }

  window.addEventListener("focus", revealUi);
  root.addEventListener("focusin", revealUi);
  player?.addEventListener("mouseenter", revealUi);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearUiIdleTimer();
      root.classList.remove("is-ui-idle");
    } else {
      revealUi();
    }
  });

  loadStatus();
  window.setInterval(() => {
    if (!document.hidden) loadStatus();
  }, 30000);
})();