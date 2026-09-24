(() => {
  const root = document.querySelector("[data-live-lab]");
  if (!root) return;

  const statusUrl = root.dataset.statusUrl;
  const fallbackVideo = root.dataset.fallbackVideo || "";
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

  let currentVideoId = "";
  let busy = false;

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

  const showLive = (data) => {
    const videoId = data.video_id || fallbackVideo;
    if (!videoId) return showOffline(data);

    screen.dataset.state = "live";
    stateWrap?.classList.add("is-live");
    stateText.textContent = "Live now";
    title.textContent = data.title || "Inka MMA live";
    promotion.textContent = `${data.channel_name || "INKA MMA PRO"} · Peru`;
    updated.textContent = formatDate(data.updated_at);

    const watchUrl = data.watch_url || `https://www.youtube.com/watch?v=${videoId}`;
    source.href = watchUrl;

    if (currentVideoId !== videoId || !player.getAttribute("src")) {
      currentVideoId = videoId;
      player.src = embedUrl(videoId);
    }

    note.textContent = "The monitor will replace this video automatically when Inka starts a different YouTube live stream.";
  };

  const showOffline = (data = {}) => {
    screen.dataset.state = "offline";
    stateWrap?.classList.remove("is-live");
    stateText.textContent = "Off air";
    title.textContent = "Inka MMA is not live";
    promotion.textContent = `${data.channel_name || "INKA MMA PRO"} · Peru`;
    updated.textContent = formatDate(data.updated_at);
    standbyTitle.textContent = "Inka MMA is off air";
    standbyCopy.textContent = "This player will activate when the monitor detects the next live fight stream.";

    if (player.getAttribute("src")) player.removeAttribute("src");
    currentVideoId = "";

    if (data.channel_url) {
      source.href = data.channel_url;
      source.textContent = "Open Inka channel ↗";
    }

    note.textContent = "Standby mode. The page keeps checking the live-state file automatically.";
  };

  const showChecking = () => {
    if (currentVideoId) return;
    screen.dataset.state = "checking";
    stateWrap?.classList.remove("is-live");
    stateText.textContent = "Checking Inka…";
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

      if (data.is_live && data.video_id) showLive(data);
      else showOffline(data);
    } catch (error) {
      console.warn("Inka live status unavailable", error);
      stateText.textContent = currentVideoId ? "Live status delayed" : "Monitor unavailable";
      if (!currentVideoId && fallbackVideo) {
        showLive({
          is_live: true,
          video_id: fallbackVideo,
          title: "Inka 61",
          channel_name: "INKA MMA PRO",
          watch_url: `https://www.youtube.com/watch?v=${fallbackVideo}`
        });
        stateText.textContent = "Fallback stream";
      }
      note.textContent = "The status monitor could not be reached. The page is using its last known/fallback stream.";
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