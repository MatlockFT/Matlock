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
  const ambientStage = root.querySelector("[data-live-ambient-stage]");
  const ambientLayers = [
    root.querySelector("[data-live-ambient-a]"),
    root.querySelector("[data-live-ambient-b]")
  ].filter(Boolean);

  let currentVideoId = "";
  let ambientVideoId = "";
  let ambientLayerIndex = 0;
  let busy = false;
  let lastData = null;

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

  const thumbnailCandidates = (videoId) => [
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
  ];

  const resolveThumbnail = (videoId) =>
    new Promise((resolve) => {
      const candidates = thumbnailCandidates(videoId);
      let index = 0;

      const tryNext = () => {
        if (index >= candidates.length) {
          resolve("");
          return;
        }

        const url = candidates[index++];
        const image = new Image();
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.onload = () => {
          const looksValid = image.naturalWidth >= 320 && image.naturalHeight >= 180;
          if (looksValid) resolve(url);
          else tryNext();
        };
        image.onerror = tryNext;
        image.src = url;
      };

      tryNext();
    });

  const setAmbientVideo = async (videoId) => {
    if (!ambientStage || !ambientLayers.length || !videoId || videoId === ambientVideoId) return;

    const requestedVideoId = videoId;
    const imageUrl = await resolveThumbnail(videoId);
    if (!imageUrl || currentVideoId !== requestedVideoId) return;

    const nextIndex = ambientLayers.length > 1
      ? (ambientLayerIndex + 1) % ambientLayers.length
      : 0;
    const nextLayer = ambientLayers[nextIndex];

    nextLayer.style.backgroundImage = `url("${imageUrl}")`;
    nextLayer.classList.add("is-active");

    ambientLayers.forEach((layer, index) => {
      if (index !== nextIndex) layer.classList.remove("is-active");
    });

    ambientLayerIndex = nextIndex;
    ambientVideoId = requestedVideoId;
    ambientStage.classList.add("is-ambient-active");
  };

  const clearAmbientVideo = () => {
    ambientVideoId = "";
    ambientStage?.classList.remove("is-ambient-active");
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
      button.addEventListener("click", () => setPlayer(event));
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

    setAmbientVideo(event.video_id);
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
    clearAmbientVideo();

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

  refresh?.addEventListener("click", loadStatus);
  window.addEventListener("online", loadStatus);

  loadStatus();
  window.setInterval(() => {
    if (!document.hidden) loadStatus();
  }, 30000);
})();