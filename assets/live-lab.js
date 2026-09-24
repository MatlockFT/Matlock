(() => {
  const root = document.querySelector("[data-live-lab]");
  if (!root) return;

  const statusUrl = root.dataset.statusUrl;
  const player = root.querySelector("[data-live-player]");
  const screen = root.querySelector("[data-live-screen]");
  const stateWrap = root.querySelector(".live-lab__hero-state");
  const stateText = root.querySelector("[data-live-state]");
  const title = root.querySelector("[data-live-title]");
  const promotion = root.querySelector("[data-live-promotion]");
  const updated = root.querySelector("[data-live-updated]");
  const source = root.querySelector("[data-live-source]");
  const refresh = root.querySelector("[data-live-refresh]");
  const standbyTitle = root.querySelector("[data-live-standby-title]");
  const standbyCopy = root.querySelector("[data-live-standby-copy]");
  const note = root.querySelector("[data-live-note]");
  const liveList = root.querySelector("[data-live-list]");
  const liveCount = root.querySelector("[data-live-count]");
  const upcomingList = root.querySelector("[data-upcoming-list]");
  const upcomingCount = root.querySelector("[data-upcoming-count]");
  const monitored = root.querySelector("[data-live-monitored]");
  const apiStatus = root.querySelector("[data-api-status]");
  const sourceList = root.querySelector("[data-source-list]");

  let currentVideoId = "";
  let currentEventId = "";
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

  const formatDate = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(parsed);
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

  const setPlayer = (event) => {
    if (!event || !event.video_id) return;

    currentVideoId = event.video_id;
    currentEventId = event.event_id || "";
    screen.dataset.state = "live";
    stateWrap?.classList.add("is-live");
    stateText.textContent = event.stale ? "Live status delayed" : "Live now";
    title.textContent = event.title || "Live MMA";
    promotion.textContent = `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}`;

    const watchUrl = event.watch_url || `https://www.youtube.com/watch?v=${event.video_id}`;
    source.href = watchUrl;
    source.hidden = false;
    source.textContent = "Open on YouTube ↗";

    if (!player.getAttribute("src") || !player.src.includes(event.video_id)) {
      player.src = embedUrl(event.video_id);
    }

    renderLiveEvents(lastData?.events || []);
  };

  const showStandby = (upcoming = []) => {
    screen.dataset.state = "offline";
    stateWrap?.classList.remove("is-live");
    stateText.textContent = "Standby";
    title.textContent = "No monitored MMA is live";
    promotion.textContent = "Waiting for the next detected broadcast";

    const next = Array.isArray(upcoming) ? upcoming[0] : null;
    if (next) {
      standbyTitle.textContent = "Next broadcast scheduled";
      standbyCopy.textContent = `${next.short_name || next.promotion || "MMA"} · ${formatSchedule(next.scheduled_start_time)}`;
    } else {
      standbyTitle.textContent = "No live MMA detected";
      standbyCopy.textContent = "The station will activate when a monitored promotion goes live.";
    }

    source.hidden = true;

    if (player.getAttribute("src")) player.removeAttribute("src");
    currentVideoId = "";
    currentEventId = "";

    renderLiveEvents(lastData?.events || []);
  };

  const renderLiveEvents = (events) => {
    if (!liveList) return;

    const activeEvents = Array.isArray(events) ? events : [];
    liveCount.textContent = `${activeEvents.length} live`;

    if (!activeEvents.length) {
      liveList.innerHTML = '<p class="live-lab__empty">No monitored fight streams are live right now.</p>';
      return;
    }

    liveList.innerHTML = "";

    for (const event of activeEvents) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-lab__event";
      button.dataset.eventId = event.event_id || "";
      if (event.video_id === currentVideoId) button.classList.add("is-playing");

      const status = document.createElement("span");
      status.className = "live-lab__event-status";
      status.textContent = event.video_id === currentVideoId
        ? "Playing"
        : (event.stale ? "Status delayed" : "Live");

      const name = document.createElement("strong");
      name.textContent = event.title || "Live MMA";

      const meta = document.createElement("span");
      meta.className = "live-lab__event-meta";
      const viewers = event.concurrent_viewers
        ? ` · ${Number(event.concurrent_viewers).toLocaleString()} watching`
        : "";
      const verified = event.api_verified ? " · API verified" : " · fallback";
      meta.textContent =
        `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}` +
        `${event.coverage_note ? ` · ${event.coverage_note}` : ""}${viewers}${verified}`;

      button.append(status, name, meta);
      button.addEventListener("click", () => setPlayer(event));
      liveList.append(button);
    }
  };

  const renderUpcoming = (events) => {
    if (!upcomingList || !upcomingCount) return;

    const scheduled = Array.isArray(events) ? events : [];
    upcomingCount.textContent = `${scheduled.length} upcoming`;

    if (!scheduled.length) {
      upcomingList.innerHTML = '<p class="live-lab__empty">No scheduled YouTube broadcasts detected yet.</p>';
      return;
    }

    upcomingList.innerHTML = "";

    for (const event of scheduled.slice(0, 12)) {
      const card = document.createElement("a");
      card.className = "live-lab__upcoming";
      card.href = event.watch_url || `https://www.youtube.com/watch?v=${event.video_id}`;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      const time = document.createElement("span");
      time.className = "live-lab__upcoming-time";
      time.textContent = formatSchedule(event.scheduled_start_time);

      const name = document.createElement("strong");
      name.textContent = event.title || "Upcoming MMA";

      const meta = document.createElement("span");
      meta.className = "live-lab__event-meta";
      meta.textContent =
        `${event.short_name || event.promotion || "MMA"} · ${event.country || "International"}` +
        `${event.coverage_note ? ` · ${event.coverage_note}` : ""}`;

      card.append(time, name, meta);
      upcomingList.append(card);
    }
  };

  const renderSources = (sources) => {
    if (!sourceList) return;
    const entries = Object.values(sources || {});
    sourceList.innerHTML = "";

    if (!entries.length) {
      sourceList.innerHTML = "<span>No sources loaded.</span>";
      return;
    }

    entries
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .forEach((item) => {
        const pill = document.createElement("span");
        pill.className = "live-lab__source";
        pill.dataset.status = item.status || "unknown";

        const label = document.createElement("strong");
        label.textContent = item.short_name || item.promotion || "MMA";

        const status = document.createElement("small");
        const statusText = {
          live: "live",
          upcoming: "upcoming",
          offline: "offline",
          ignored_live: "ignored live",
          restricted_live: "restricted live",
          unembeddable_live: "embed blocked",
          error: "check delayed"
        }[item.status] || item.status || "unknown";

        const verified = item.verification === "youtube_api" ? " · API" : "";
        status.textContent = `${statusText}${verified}`;

        pill.append(label, status);
        sourceList.append(pill);
      });
  };

  const applyData = (data) => {
    lastData = data;
    const events = Array.isArray(data.events) ? data.events : [];
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];

    monitored.textContent = `${data.monitored_count ?? Object.keys(data.sources || {}).length} promotions`;
    updated.textContent = formatDate(data.generated_at);

    if (apiStatus) {
      apiStatus.textContent = data.youtube_api_configured
        ? `YouTube API · ${data.api_verified_source_count || 0} verified this state`
        : "HTML fallback only";
    }

    renderSources(data.sources || {});
    renderUpcoming(upcoming);

    const currentStillLive = currentVideoId ? findEventByVideo(events, currentVideoId) : null;
    if (currentStillLive) {
      setPlayer(currentStillLive);
      return;
    }

    const selected =
      findEventById(events, data.selected_event_id) ||
      events[0] ||
      null;

    if (selected) setPlayer(selected);
    else showStandby(upcoming);

    renderLiveEvents(events);
  };

  const showChecking = () => {
    if (currentVideoId) return;
    screen.dataset.state = "checking";
    stateWrap?.classList.remove("is-live");
    stateText.textContent = "Checking the world…";
  };

  const loadStatus = async ({ manual = false } = {}) => {
    if (busy) return;
    busy = true;
    if (manual) showChecking();

    try {
      const separator = statusUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${statusUrl}${separator}t=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });

      if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
      const data = await response.json();
      applyData(data);

      note.textContent =
        "Automatic mode keeps the stream you are watching until it ends, then moves to the next detected live card. Scheduled broadcasts are verified with the YouTube Data API; public channel parsing remains available as a fallback.";
    } catch (error) {
      console.warn("Global live status unavailable", error);
      stateText.textContent = currentVideoId ? "Live status delayed" : "Monitor unavailable";
      note.textContent =
        "The live-state feed could not be reached. The current player is being preserved until the monitor returns.";
    } finally {
      busy = false;
    }
  };

  refresh?.addEventListener("click", () => loadStatus({ manual: true }));
  window.addEventListener("online", () => loadStatus({ manual: true }));

  loadStatus();
  window.setInterval(() => {
    if (!document.hidden) loadStatus();
  }, 30000);
})();