(() => {
  const rail = document.querySelector("[data-post-news-rail]");
  if (!rail) return;

  const list = rail.querySelector("[data-post-news-list]");
  const remoteUrl = rail.dataset.feedUrl;
  const apiFallbackUrl = rail.dataset.apiFallbackUrl;
  const localFallbackUrl = rail.dataset.fallbackUrl;
  const COUNT = 5;

  function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function relativeTime(value) {
    const date = safeDate(value);
    if (!date) return "Recent";
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const ranges = [
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60]
    ];
    for (const [unit, size] of ranges) {
      if (Math.abs(seconds) >= size || unit === "minute") {
        const amount = Math.round(seconds / size);
        return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(amount, unit);
      }
    }
    return "Recent";
  }

  function normalize(data) {
    const stories = [data?.topStory, ...(Array.isArray(data?.stories) ? data.stories : [])]
      .filter(story => story?.title && story?.url);
    const seen = new Set();
    return stories
      .filter(story => {
        const key = story.id || story.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (safeDate(b.publishedAt)?.getTime() || 0) - (safeDate(a.publishedAt)?.getTime() || 0))
      .slice(0, COUNT);
  }

  async function fetchJson(url) {
    if (!url) throw new Error("Missing news URL");
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error("News request failed");
    const payload = await response.json();
    return typeof payload.body === "string" && payload.tag_name
      ? JSON.parse(payload.body)
      : payload;
  }

  async function load() {
    let data = null;
    for (const url of [remoteUrl, apiFallbackUrl, localFallbackUrl]) {
      try {
        data = await fetchJson(url);
        if (normalize(data).length) break;
      } catch {
        data = null;
      }
    }

    const stories = normalize(data);
    if (!stories.length) {
      list.innerHTML = '<p class="post-rail-news-error">Latest headlines are temporarily unavailable.</p>';
      list.setAttribute("aria-busy", "false");
      return;
    }

    const fragment = document.createDocumentFragment();
    stories.forEach(story => {
      const article = document.createElement("article");
      article.className = "post-rail-news-item";

      const meta = document.createElement("p");
      meta.className = "post-rail-news-meta";
      const source = document.createElement("span");
      source.textContent = story.source || "MMA News";
      const time = document.createElement("span");
      time.textContent = relativeTime(story.publishedAt);
      meta.append(source, time);

      const heading = document.createElement("h3");
      const link = document.createElement("a");
      link.href = story.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = story.title;
      heading.append(link);

      article.append(meta, heading);
      fragment.append(article);
    });

    list.replaceChildren(fragment);
    list.setAttribute("aria-busy", "false");
  }

  load();
})();