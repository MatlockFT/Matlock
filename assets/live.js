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
  const source = root.querySelector("[data-live-source]");
  const refresh = root.querySelector("[data-live-refresh]");
  const standbyTitle = root.querySelector("[data-live-standby-title]");
  const standbyCopy = root.querySelector("[data-live-standby-copy]");
  const liveList = root.querySelector("[data-live-list]");
  const liveCount = root.querySelector("[data-live-count]");
  const upcomingList = root.querySelector("[data-upcoming-list]");
  const upcomingCount = root.querySelector("[data-upcoming-count]");
  const replayArm = root.querySelector("[data-replay-arm]");
  const replaySave = root.querySelector("[data-replay-save]");
  const replayStatus = root.querySelector("[data-replay-status]");

  let currentVideoId = "";
  let busy = false;
  let lastData = null;
  let uiIdleTimer = 0;
  let replayStream = null;
  let replayRecorder = null;
  let replayChunks = [];
  let replayStartedAt = 0;
  let replayMimeType = "";
  let replayStopping = false;

  const UI_IDLE_DELAY = 5000;
  const REPLAY_BUFFER_MS = 15000;
  const REPLAY_CHUNK_MS = 1000;

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

  const setReplayStatus = (message) => {
    if (replayStatus) replayStatus.textContent = message;
  };

  const replaySupported = () =>
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getDisplayMedia) &&
    "MediaRecorder" in window &&
    "CropTarget" in window &&
    typeof window.CropTarget?.fromElement === "function";

  const chooseReplayMimeType = () => {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4"
    ];

    return types.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  };

  const resetReplayUi = (status = "Off") => {
    replayArm?.classList.remove("is-buffering");
    if (replayArm) {
      replayArm.disabled = false;
      replayArm.textContent = "Arm 15s replay";
      replayArm.setAttribute("aria-pressed", "false");
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
    replayStartedAt = 0;
    replayMimeType = "";

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
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 }
        },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "include"
      });

      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack || typeof videoTrack.cropTo !== "function") {
        throw new Error("Player-only crop is unavailable in this browser.");
      }

      try {
        videoTrack.contentHint = "motion";
      } catch {
        // Optional optimization only.
      }

      try {
        await videoTrack.applyConstraints({
          frameRate: { max: 30 }
        });
      } catch {
        // Capture can continue at the browser-selected rate.
      }

      const cropTarget = await CropTarget.fromElement(screen);
      await videoTrack.cropTo(cropTarget);

      replayMimeType = chooseReplayMimeType();
      const recorderOptions = {
        videoBitsPerSecond: 5000000,
        audioBitsPerSecond: 128000
      };
      if (replayMimeType) recorderOptions.mimeType = replayMimeType;

      const recorder = new MediaRecorder(stream, recorderOptions);
      replayStream = stream;
      replayRecorder = recorder;
      replayChunks = [];
      replayStartedAt = performance.now();

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data || event.data.size <= 0) return;
        const now = performance.now();
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

      if (replayArm) {
        replayArm.disabled = false;
        replayArm.textContent = "Stop buffer";
        replayArm.setAttribute("aria-pressed", "true");
        replayArm.classList.add("is-buffering");
      }

      const hasAudio = stream.getAudioTracks().length > 0;
      setReplayStatus(hasAudio ? "Buffering…" : "Buffering video only");
      updateReplayReadyState();
      scheduleUiFade();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      console.warn("Replay buffer unavailable", error);

      const denied = error?.name === "NotAllowedError";
      const cropFailure = !denied && /crop|current tab|player-only/i.test(String(error?.message || ""));
      setReplayStatus(
        denied
          ? "Capture cancelled"
          : cropFailure
            ? "Choose This Tab in Chrome/Edge"
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

    const type =
      replayMimeType ||
      selected.find((chunk) => chunk.blob.type)?.blob.type ||
      "video/webm";
    const blob = new Blob(selected.map((chunk) => chunk.blob), { type });
    const extension = type.includes("mp4") ? "mp4" : "webm";
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

    setReplayStatus("Saved last 15s");
    window.setTimeout(updateReplayReadyState, 1800);
  };

  const embedUrl = (videoId) => {
    const params = new URLSearchParams({
      autoplay: "1",
      playsinline: "1",
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
    if (!liveList || !liveCount) return;

    const active = Array.isArray(events) ? events : [];
    liveCount.textContent = active.length === 1 ? "1 live" : `${active.length} live`;

    if (!active.length) {
      liveList.innerHTML =
        '<div class="live-page__empty"><strong>Nothing is live right now.</strong><span>The next public fight stream will appear here automatically.</span></div>';
      return;
    }

    liveList.innerHTML = "";

    for (const event of active) {
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
    if (!event || !event.video_id) return;

    currentVideoId = event.video_id;
    screen.dataset.state = "live";
    stateWrap?.classList.add("is-live");
    stateText.textContent = event.stale ? "Live status delayed" : "Live now";
    title.textContent = event.title || "Live MMA";
    promotion.textContent =
      `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}`;

    source.href = event.watch_url || `https://www.youtube.com/watch?v=${event.video_id}`;
    source.hidden = false;

    if (!player.getAttribute("src") || !player.src.includes(event.video_id)) {
      player.src = embedUrl(event.video_id);
    }

    scheduleUiFade();
    renderLiveEvents(lastData?.events || []);
  };

  const showStandby = (upcoming) => {
    screen.dataset.state = "offline";
    stateWrap?.classList.remove("is-live");
    stateText.textContent = "No fights live";
    title.textContent = "No live broadcasts right now";
    promotion.textContent = "See what is coming up next";
    source.hidden = true;

    if (player.getAttribute("src")) player.removeAttribute("src");
    currentVideoId = "";
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
    lastData = data;

    const events = Array.isArray(data.events) ? data.events : [];
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];

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
      stateText.textContent = currentVideoId
        ? "Live status delayed"
        : "Updates temporarily unavailable";
    } finally {
      busy = false;
    }
  };

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