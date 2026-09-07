(() => {
    if (document.querySelector("[data-site-live-strip]")) return;

    const navigation = document.querySelector(".site-navigation");
    if (!navigation) return;

    const EVENTS_URL = "/assets/data/upcoming-events-live.json";
    const NEWS_REMOTE_URL = "https://api.github.com/repos/MatlockFT/Matlock/releases/tags/mma-news-data";
    const NEWS_FALLBACK_URL = "/assets/data/mma-news.json";
    const NEWS_REFRESH_MS = 5 * 60 * 1000;
    const EVENT_REFRESH_MS = 60 * 1000;
    const COUNTDOWN_TICK_MS = 1000;
    const FIGHT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const DEFAULT_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;
    const deviceReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/site-ticker.css?v=2";
    document.head.appendChild(stylesheet);

    const strip = document.createElement("section");
    strip.className = "site-live-strip";
    strip.dataset.siteLiveStrip = "";
    strip.setAttribute("aria-label", "Upcoming MMA events and latest MMA news");
    strip.innerHTML = `
        <div class="site-live-strip-inner">
            <div class="site-event-stack" data-event-stack>
                <button
                    class="site-event-primary"
                    type="button"
                    data-event-primary
                    aria-expanded="false"
                    aria-controls="site-event-drawer"
                >
                    <span class="site-event-primary-name" data-event-primary-name>Next event</span>
                    <span class="site-event-primary-countdown" data-event-primary-countdown>Loading…</span>
                    <span class="site-event-more" data-event-more hidden>+0</span>
                </button>
                <div
                    class="site-event-drawer"
                    id="site-event-drawer"
                    data-event-drawer
                    aria-hidden="true"
                >
                    <div class="site-event-drawer-header">
                        <span>Fight week</span>
                        <span data-event-drawer-count></span>
                    </div>
                    <ul class="site-event-list" data-event-list></ul>
                </div>
            </div>
            <div class="site-news-ticker">
                <div class="site-news-label">News</div>
                <div class="site-news-viewport" data-news-viewport aria-label="Latest MMA news">
                    <div class="site-news-track" data-news-track>
                        <div class="site-news-sequence"><span class="site-news-unavailable">Loading latest MMA news…</span></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    navigation.insertAdjacentElement("afterend", strip);

    const eventStack = strip.querySelector("[data-event-stack]");
    const eventPrimary = strip.querySelector("[data-event-primary]");
    const eventPrimaryName = strip.querySelector("[data-event-primary-name]");
    const eventPrimaryCountdown = strip.querySelector("[data-event-primary-countdown]");
    const eventMore = strip.querySelector("[data-event-more]");
    const eventDrawer = strip.querySelector("[data-event-drawer]");
    const eventDrawerCount = strip.querySelector("[data-event-drawer-count]");
    const eventList = strip.querySelector("[data-event-list]");
    const newsTrack = strip.querySelector("[data-news-track]");

    let allEvents = [];
    let fightWeekEvents = [];
    let drawerCloseTimer = 0;
    let drawerOpenTimer = 0;

    function safeDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function zoneForToken(token) {
        const value = (token || "ET").toUpperCase();
        if (["ET", "EDT", "EST"].includes(value)) return "America/New_York";
        if (["CT", "CDT", "CST"].includes(value)) return "America/Chicago";
        if (["MT", "MDT", "MST"].includes(value)) return "America/Denver";
        if (["PT", "PDT", "PST"].includes(value)) return "America/Los_Angeles";
        if (value === "JST") return "Asia/Tokyo";
        if (["UTC", "GMT"].includes(value)) return "UTC";
        return "America/New_York";
    }

    function zonedDateTime(dateString, hour, minute, timeZone) {
        const [year, month, day] = dateString.split("-").map(Number);
        if (!year || !month || !day) return null;

        const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        let guess = desiredUtc;
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        });

        for (let index = 0; index < 3; index += 1) {
            const parts = Object.fromEntries(
                formatter.formatToParts(new Date(guess))
                    .filter(part => part.type !== "literal")
                    .map(part => [part.type, Number(part.value)])
            );
            const representedUtc = Date.UTC(
                parts.year,
                parts.month - 1,
                parts.day,
                parts.hour,
                parts.minute,
                0
            );
            guess += desiredUtc - representedUtc;
        }

        return new Date(guess);
    }

    function parseSectionTime(event, value) {
        if (!event?.date || !value) return null;

        const matches = [...String(value).matchAll(
            /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(ET|EDT|EST|CT|CDT|CST|MT|MDT|MST|PT|PDT|PST|JST|UTC|GMT)?\b/gi
        )];

        for (const match of matches) {
            let hour = Number(match[1]);
            const minute = Number(match[2] || 0);
            const meridiem = (match[3] || "").toUpperCase();
            const zoneToken = (match[4] || "ET").toUpperCase();

            if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) continue;
            if (meridiem === "PM" && hour < 12) hour += 12;
            if (meridiem === "AM" && hour === 12) hour = 0;
            if (meridiem && Number(match[1]) > 12) continue;

            const parsed = zonedDateTime(event.date, hour, minute, zoneForToken(zoneToken));
            if (parsed) return parsed;
        }

        return null;
    }

    function eventTiming(event) {
        const explicitStart = safeDate(event.starts_at);
        const explicitEnd = safeDate(event.expires_at);

        if (explicitStart) {
            return {
                start: explicitStart,
                end: explicitEnd || new Date(explicitStart.getTime() + DEFAULT_EVENT_LENGTH_MS),
                precise: true
            };
        }

        const sectionStarts = (event.sections || [])
            .map(section => parseSectionTime(event, section.time))
            .filter(Boolean)
            .sort((a, b) => a - b);

        if (sectionStarts.length) {
            const start = sectionStarts[0];
            return {
                start,
                end: explicitEnd || new Date(start.getTime() + DEFAULT_EVENT_LENGTH_MS),
                precise: true
            };
        }

        const fallback = safeDate(`${event.date}T12:00:00Z`);
        return {
            start: fallback,
            end: fallback ? new Date(fallback.getTime() + DEFAULT_EVENT_LENGTH_MS) : null,
            precise: false
        };
    }

    function shortEventName(event) {
        const url = String(event.official_url || "");
        const ufcNumber = url.match(/ufc-(\d{3,4})(?:\b|\/|$)/i)?.[1];
        if (ufcNumber) return `UFC ${ufcNumber}`;

        const promotion = String(event.promotion || "").trim();
        const title = String(event.title || "").trim();

        if (/dwcs/i.test(promotion)) {
            const week = title.match(/week\s*(\d+)/i)?.[1];
            return week ? `DWCS W${week}` : "DWCS";
        }

        if (/noche/i.test(promotion)) return "NOCHE UFC";
        if (/rizin/i.test(promotion)) return "RIZIN";
        if (/pfl/i.test(promotion)) return /^pfl$/i.test(promotion) ? "PFL" : promotion;
        if (/one/i.test(promotion)) return promotion;

        return promotion || title || "MMA EVENT";
    }

    function eventDetail(event) {
        const title = String(event.title || "").trim();
        const venue = String(event.venue || "").trim();
        return [title, venue].filter(Boolean).join(" · ");
    }

    function countdown(timing, now = Date.now()) {
        if (!timing?.start) return { text: "DATE TBA", live: false };

        const start = timing.start.getTime();
        const end = timing.end?.getTime() || start + DEFAULT_EVENT_LENGTH_MS;

        if (now >= start && now < end && timing.precise) {
            return { text: "LIVE NOW", live: true };
        }

        const difference = start - now;
        if (difference <= 0) return { text: "STARTED", live: false };

        if (!timing.precise) {
            return {
                text: `${Math.max(1, Math.ceil(difference / 86400000))}D`,
                live: false
            };
        }

        const totalSeconds = Math.max(0, Math.floor(difference / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const secondText = `${String(seconds).padStart(2, "0")}S`;

        if (days > 0) return { text: `${days}D ${hours}H ${minutes}M ${secondText}`, live: false };
        if (hours > 0) return { text: `${hours}H ${minutes}M ${secondText}`, live: false };
        return { text: `${minutes}M ${secondText}`, live: false };
    }

    function normalizedEvents(data) {
        const now = Date.now();
        return (Array.isArray(data?.events) ? data.events : [])
            .map(event => ({ event, timing: eventTiming(event) }))
            .filter(item => item.timing.start)
            .filter(item => {
                const end = item.timing.end?.getTime() || item.timing.start.getTime() + DEFAULT_EVENT_LENGTH_MS;
                return end > now;
            })
            .sort((a, b) => {
                const aLive = a.timing.precise && now >= a.timing.start && now < a.timing.end;
                const bLive = b.timing.precise && now >= b.timing.start && now < b.timing.end;
                if (aLive !== bLive) return aLive ? -1 : 1;
                return a.timing.start - b.timing.start;
            });
    }

    function chooseFightWeek() {
        if (!allEvents.length) return [];
        const anchor = allEvents[0].timing.start.getTime();
        return allEvents.filter(item => item.timing.start.getTime() <= anchor + FIGHT_WEEK_MS);
    }

    function setDrawer(open) {
        const canOpen = fightWeekEvents.length > 1;
        const shouldOpen = Boolean(open && canOpen);
        eventStack.classList.toggle("is-open", shouldOpen);
        eventPrimary.setAttribute("aria-expanded", String(shouldOpen));
        eventDrawer.setAttribute("aria-hidden", String(!shouldOpen));
    }

    function eventRow(item) {
        const li = document.createElement("li");
        const event = item.event;
        const url = event.official_url || "/upcoming-events/";
        const link = document.createElement("a");
        link.className = "site-event-row";
        link.href = url;
        if (/^https?:\/\//i.test(url)) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
        }

        const main = document.createElement("span");
        main.className = "site-event-row-main";
        const name = document.createElement("span");
        name.className = "site-event-row-name";
        name.textContent = shortEventName(event);
        const detail = document.createElement("span");
        detail.className = "site-event-row-detail";
        detail.textContent = eventDetail(event);
        main.append(name, detail);

        const time = document.createElement("span");
        time.className = "site-event-row-countdown";
        time.dataset.eventCountdown = "";
        time.dataset.eventId = event.id || "";

        link.append(main, time);
        li.append(link);
        return li;
    }

    function renderEvents() {
        allEvents = allEvents.filter(item => {
            const end = item.timing.end?.getTime() || item.timing.start.getTime() + DEFAULT_EVENT_LENGTH_MS;
            return end > Date.now();
        });
        allEvents.sort((a, b) => a.timing.start - b.timing.start);
        fightWeekEvents = chooseFightWeek();

        if (!fightWeekEvents.length) {
            eventPrimaryName.textContent = "Next event";
            eventPrimaryCountdown.textContent = "TBA";
            eventPrimaryCountdown.dataset.live = "false";
            eventMore.hidden = true;
            eventList.replaceChildren();
            setDrawer(false);
            return;
        }

        const primary = fightWeekEvents[0];
        eventPrimaryName.textContent = shortEventName(primary.event);
        const primaryCountdown = countdown(primary.timing);
        eventPrimaryCountdown.textContent = primaryCountdown.text;
        eventPrimaryCountdown.dataset.live = String(primaryCountdown.live);

        const additional = Math.max(0, fightWeekEvents.length - 1);
        eventMore.textContent = `+${additional}`;
        eventMore.hidden = additional === 0;
        eventDrawerCount.textContent = `${fightWeekEvents.length} event${fightWeekEvents.length === 1 ? "" : "s"}`;
        eventList.replaceChildren(...fightWeekEvents.map(eventRow));
        updateCountdowns();

        if (additional === 0) setDrawer(false);
    }

    function updateCountdowns() {
        if (!fightWeekEvents.length) return;
        const primary = fightWeekEvents[0];
        const primaryValue = countdown(primary.timing);
        eventPrimaryCountdown.textContent = primaryValue.text;
        eventPrimaryCountdown.dataset.live = String(primaryValue.live);

        strip.querySelectorAll("[data-event-countdown]").forEach(node => {
            const item = fightWeekEvents.find(entry => (entry.event.id || "") === node.dataset.eventId);
            if (!item) return;
            const value = countdown(item.timing);
            node.textContent = value.text;
            node.dataset.live = String(value.live);
        });
    }

    async function fetchJson(url, cacheBucket = false) {
        const requestUrl = new URL(url, window.location.href);
        if (cacheBucket) requestUrl.searchParams.set("update", String(Math.floor(Date.now() / NEWS_REFRESH_MS)));
        const response = await fetch(requestUrl, {
            cache: "no-store",
            headers: { accept: "application/json" }
        });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const raw = await response.json();
        if (typeof raw.body === "string" && raw.tag_name) return JSON.parse(raw.body);
        return raw;
    }

    async function loadEvents() {
        try {
            const data = await fetchJson(EVENTS_URL);
            allEvents = normalizedEvents(data);
            renderEvents();
        } catch {
            eventPrimaryName.textContent = "Upcoming events";
            eventPrimaryCountdown.textContent = "View card";
            eventMore.hidden = true;
        }
    }

    function validNews(data) {
        return Boolean(data?.topStory?.title && data?.topStory?.url && Array.isArray(data?.stories));
    }

    function newsStories(data) {
        const seen = new Set();
        return [data.topStory, ...(data.stories || [])]
            .filter(story => story?.title && story?.url)
            .filter(story => {
                const key = story.id || story.url;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => {
                const aTime = safeDate(a.publishedAt)?.getTime() || 0;
                const bTime = safeDate(b.publishedAt)?.getTime() || 0;
                return bTime - aTime;
            })
            .slice(0, 14);
    }

    function newsAnchor(story) {
        const link = document.createElement("a");
        link.className = "site-news-item";
        link.href = story.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        if (story.source) {
            const source = document.createElement("span");
            source.className = "site-news-item-source";
            source.textContent = story.source;
            link.append(source);
        }

        const title = document.createElement("span");
        title.textContent = story.title;
        link.append(title);
        return link;
    }

    function renderNews(data) {
        const stories = newsStories(data);
        if (!stories.length) throw new Error("No stories");

        const buildSequence = () => {
            const sequence = document.createElement("div");
            sequence.className = "site-news-sequence";
            sequence.append(...stories.map(newsAnchor));
            return sequence;
        };

        newsTrack.replaceChildren(buildSequence(), buildSequence());
        window.requestAnimationFrame(() => {
            const sequence = newsTrack.querySelector(".site-news-sequence");
            if (!sequence) return;
            const duration = Math.max(36, Math.round(sequence.scrollWidth / 48));
            newsTrack.style.setProperty("--site-news-duration", `${duration}s`);
        });
    }

    async function loadNews() {
        try {
            const remote = await fetchJson(NEWS_REMOTE_URL, true);
            if (!validNews(remote)) throw new Error("Invalid news feed");
            renderNews(remote);
        } catch {
            try {
                const fallback = await fetchJson(NEWS_FALLBACK_URL);
                if (!validNews(fallback)) throw new Error("Invalid fallback feed");
                renderNews(fallback);
            } catch {
                const sequence = document.createElement("div");
                sequence.className = "site-news-sequence";
                const unavailable = document.createElement("span");
                unavailable.className = "site-news-unavailable";
                unavailable.textContent = "Latest MMA news is temporarily unavailable";
                sequence.append(unavailable);
                newsTrack.replaceChildren(sequence);
            }
        }
    }

    eventPrimary.addEventListener("click", () => {
        setDrawer(!eventStack.classList.contains("is-open"));
    });

    eventStack.addEventListener("pointerenter", event => {
        if (event.pointerType === "touch" || fightWeekEvents.length < 2) return;
        window.clearTimeout(drawerCloseTimer);
        window.clearTimeout(drawerOpenTimer);
        drawerOpenTimer = window.setTimeout(() => setDrawer(true), 110);
    });

    eventStack.addEventListener("pointerleave", event => {
        if (event.pointerType === "touch") return;
        window.clearTimeout(drawerOpenTimer);
        window.clearTimeout(drawerCloseTimer);
        drawerCloseTimer = window.setTimeout(() => setDrawer(false), 180);
    });

    eventStack.addEventListener("focusin", () => {
        if (fightWeekEvents.length > 1) setDrawer(true);
    });

    eventStack.addEventListener("focusout", event => {
        if (!eventStack.contains(event.relatedTarget)) setDrawer(false);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && eventStack.classList.contains("is-open")) {
            setDrawer(false);
            eventPrimary.focus();
        }
    });

    document.addEventListener("click", event => {
        if (!eventStack.contains(event.target)) setDrawer(false);
    });

    deviceReducedMotion.addEventListener?.("change", () => {
        newsTrack.style.animationPlayState = deviceReducedMotion.matches ? "paused" : "running";
    });

    loadEvents();
    loadNews();

    window.setInterval(() => {
        updateCountdowns();
        const first = allEvents[0];
        if (first?.timing?.end && Date.now() >= first.timing.end.getTime()) renderEvents();
    }, COUNTDOWN_TICK_MS);

    window.setInterval(loadEvents, EVENT_REFRESH_MS);
    window.setInterval(loadNews, NEWS_REFRESH_MS);
})();
