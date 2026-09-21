(() => {
    const root = document.querySelector('[data-home-dashboard]');
    if (!root) return;

    const newsList = root.querySelector('[data-home-news-list]');
    const otdBody = root.querySelector('[data-home-otd-body]');
    const rosterBody = root.querySelector('[data-home-roster-body]');
    const cinemaHero = root.querySelector('[data-cinema-hero]');
    const featurePanels = [...root.querySelectorAll('[data-feature-panel]')];

    const liveNewsUrl = root.dataset.newsUrl;
    const fallbackNewsUrl = root.dataset.newsFallbackUrl;
    const historyUrl = root.dataset.historyUrl;
    const historyRuntimeBase = root.dataset.historyRuntimeBase;
    const rosterUrl = root.dataset.rosterUrl;
    const historyTimeZone = 'America/Chicago';

    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const lerp = (start, end, amount) => start + (end - start) * amount;

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const safeJson = async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    };

    const fetchJson = async (url, cache = 'no-store') => {
        if (!url) throw new Error('Missing URL');
        return safeJson(await fetch(url, { cache }));
    };

    const reduceMotion = () =>
        document.documentElement.classList.contains('reduce-motion') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const formatSource = story => story?.source || 'Source';

    const relativeTime = value => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const diff = Date.now() - date.getTime();
        const minutes = Math.max(0, Math.floor(diff / 60000));
        if (minutes < 60) return `${Math.max(1, minutes)}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        return `${Math.floor(hours / 24)}d`;
    };

    const newsStories = data => {
        const seen = new Set();
        return [data?.topStory, ...(data?.stories || [])]
            .filter(story => story?.title && story?.url)
            .filter(story => {
                const key = story.id || story.url;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 5);
    };

    const sectionLink = (label, href) => {
        const link = element('a', 'home-side-link', label);
        link.href = href;
        return link;
    };

    let newsObserver = null;

    const observeNewsRows = () => {
        if (!newsList || reduceMotion() || !('IntersectionObserver' in window)) return;
        newsObserver?.disconnect();
        newsObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                entry.target.animate(
                    [
                        { opacity: 0, transform: 'translate3d(-24px, 0, 0)' },
                        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                    ],
                    {
                        duration: 420,
                        easing: 'cubic-bezier(.2,.8,.2,1)',
                        fill: 'both'
                    }
                );
                newsObserver.unobserve(entry.target);
            }
        }, { threshold: 0.18 });

        [...newsList.querySelectorAll('.home-news-item')].forEach(row => newsObserver.observe(row));
    };

    function renderNews(data) {
        if (!newsList) return;
        const stories = newsStories(data);
        newsList.replaceChildren();

        if (!stories.length) {
            newsList.append(sectionLink('News →', '/news/'));
            return;
        }

        for (const story of stories) {
            const row = element('article', 'home-news-item');
            const link = element('a', '', story.title);
            link.href = story.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const meta = element(
                'span',
                '',
                [formatSource(story), relativeTime(story.publishedAt)].filter(Boolean).join(' · ')
            );
            row.append(link, meta);
            newsList.append(row);
        }

        observeNewsRows();
    }

    async function loadNews() {
        if (!newsList) return;
        for (const url of [liveNewsUrl, fallbackNewsUrl].filter(Boolean)) {
            try {
                renderNews(await fetchJson(url));
                return;
            } catch {}
        }
        renderNews({ stories: [] });
    }

    const currentHistoryKey = () => {
        const parts = Object.fromEntries(
            new Intl.DateTimeFormat('en-US', {
                timeZone: historyTimeZone,
                month: '2-digit',
                day: '2-digit'
            })
                .formatToParts(new Date())
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, part.value])
        );
        return `${parts.month}-${parts.day}`;
    };

    const latestHistoryEntry = (entries, key) => {
        const todays = entries.filter(entry => String(entry?.date || '').slice(5) === key);
        const events = todays.filter(entry => entry?.kind === 'event');
        const candidates = events.length ? events : todays;
        return candidates.sort((a, b) => {
            const dateOrder = String(b?.date || '').localeCompare(String(a?.date || ''));
            if (dateOrder) return dateOrder;
            const imageOrder = Number(Boolean(b?.imageUrl)) - Number(Boolean(a?.imageUrl));
            if (imageOrder) return imageOrder;
            return Number(b?.weight || 0) - Number(a?.weight || 0);
        })[0] || null;
    };

    function renderOnThisDay(entry, key) {
        if (!otdBody) return;
        otdBody.replaceChildren();
        if (!entry) {
            otdBody.append(sectionLink('History →', '/on-this-day/'));
            return;
        }

        const historyHref = `/on-this-day/?date=${encodeURIComponent(
            key || String(entry.date || '').slice(5)
        )}`;

        if (/^https:\/\//i.test(String(entry.imageUrl || ''))) {
            const imageLink = element('a', 'home-otd-image');
            imageLink.href = historyHref;
            imageLink.setAttribute('aria-label', `Open ${entry.title || 'this MMA history entry'}`);
            const image = document.createElement('img');
            image.src = entry.imageUrl;
            image.alt = entry.imageAlt || entry.title || 'MMA history image';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('error', () => imageLink.remove(), { once: true });
            imageLink.append(image);
            otdBody.append(imageLink);
        }

        const copy = element('div', 'home-otd-copyblock');
        const year = String(entry.date || '').slice(0, 4);
        const label = element('span', 'home-otd-year', year || 'On this day');
        const title = element('h3', 'home-otd-title', entry.title || 'MMA history');
        copy.append(label, title);
        const detail = entry.detail || entry.description || '';
        if (detail) copy.append(element('p', 'home-otd-copy', detail));
        copy.append(sectionLink('History →', historyHref));
        otdBody.append(copy);
    }

    async function loadOnThisDay() {
        if (!otdBody || !historyUrl) return;
        const key = currentHistoryKey();

        try {
            const snapshot = await fetchJson(historyUrl, 'no-store');
            if (snapshot?.entry !== undefined && snapshot?.key === key) {
                renderOnThisDay(snapshot.entry, key);
                return;
            }
        } catch {}

        try {
            const month = key.slice(0, 2);
            const runtimeUrl = historyRuntimeBase ? `${historyRuntimeBase}${month}.json` : '';
            const data = await fetchJson(runtimeUrl, 'no-store');
            const entries = Array.isArray(data)
                ? data
                : Array.isArray(data?.entries)
                    ? data.entries
                    : [];
            renderOnThisDay(latestHistoryEntry(entries, key), key);
        } catch {
            renderOnThisDay(null, key);
        }
    }

    const fighterName = fighter => {
        const name = String(fighter?.name || '').replace(/\s+/g, ' ').trim();
        if (
            name &&
            !/^(search results|search|athletes|all athletes|ufc|page not found|not found)$/i.test(name)
        ) {
            return name;
        }

        const slug = String(fighter?.slug || fighter?.url || '')
            .split('/')
            .filter(Boolean)
            .at(-1) || '';

        return slug
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Recent addition';
    };

    function renderRoster(data) {
        if (!rosterBody) return;
        rosterBody.replaceChildren();
        const addition = Array.isArray(data?.additions) ? data.additions[0] : null;

        if (addition) {
            rosterBody.append(element('h3', 'home-roster-name', fighterName(addition)));
            const details = [addition.division, addition.record].filter(Boolean).join(' · ');
            if (details) rosterBody.append(element('p', 'home-roster-meta', details));
        }

        rosterBody.append(sectionLink('Roster →', '/ufc-roster/'));
    }

    async function loadRoster() {
        if (!rosterBody || !rosterUrl) return;
        try {
            const release = await fetchJson(rosterUrl);
            const data = JSON.parse(release?.body || '{}');
            renderRoster(data);
        } catch {
            renderRoster({ additions: [] });
        }
    }

    const runWhenIdle = (task, delay, timeout = 900) => {
        window.setTimeout(() => {
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => task(), { timeout });
            } else {
                task();
            }
        }, delay);
    };

    const startDeferredLoads = () => {
        runWhenIdle(loadNews, 0, 650);
        runWhenIdle(loadOnThisDay, 180, 900);
        runWhenIdle(loadRoster, 360, 1100);
        runWhenIdle(initWebGpuTexture, 520, 1400);
    };

    const sectionProgress = section => {
        if (!section) return 0;
        const rect = section.getBoundingClientRect();
        const travel = Math.max(1, section.offsetHeight - window.innerHeight);
        return clamp(-rect.top / travel);
    };

    function updateHeroFlow() {
        if (!cinemaHero) return;
        const stage = cinemaHero.querySelector('[data-cinema-stage]');
        if (!stage) return;

        if (reduceMotion()) {
            stage.style.setProperty('--hero-shift', '0px');
            stage.style.setProperty('--hero-scale', '1');
            stage.style.setProperty('--hero-image-opacity', '1');
            stage.style.setProperty('--hero-copy-shift', '0px');
            stage.style.setProperty('--hero-copy-opacity', '1');
            stage.style.setProperty('--hero-vignette', '.74');
            return;
        }

        const progress = sectionProgress(cinemaHero);
        const exit = clamp((progress - 0.42) / 0.58);
        const copyExit = clamp((progress - 0.48) / 0.34);
        const viewport = window.innerHeight;

        stage.style.setProperty('--hero-shift', `${Math.round(lerp(0, -viewport * 0.28, exit))}px`);
        stage.style.setProperty('--hero-scale', lerp(1, 1.075, exit).toFixed(4));
        stage.style.setProperty('--hero-image-opacity', lerp(1, 0.2, exit).toFixed(3));
        stage.style.setProperty('--hero-copy-shift', `${Math.round(lerp(0, -86, copyExit))}px`);
        stage.style.setProperty('--hero-copy-opacity', lerp(1, 0, copyExit).toFixed(3));
        stage.style.setProperty('--hero-vignette', lerp(0.74, 0.94, exit).toFixed(3));
    }

    function updateFeatureFlow(panel) {
        if (!panel) return;
        const stage = panel.querySelector('[data-feature-stage]');
        if (!stage) return;

        if (reduceMotion()) {
            panel.style.setProperty('--feature-shift', '0px');
            panel.style.setProperty('--feature-scale', '1');
            panel.style.setProperty('--feature-opacity', '1');
            panel.style.setProperty('--feature-copy-shift', '0px');
            panel.style.setProperty('--feature-copy-opacity', '1');
            panel.style.setProperty('--feature-wash-opacity', '.16');
            panel.style.setProperty('--feature-progress-width', '100%');
            return;
        }

        const progress = sectionProgress(panel);
        const entry = clamp(progress / 0.22);
        const settle = clamp((progress - 0.14) / 0.28);
        const exit = clamp((progress - 0.67) / 0.33);
        const viewport = window.innerHeight;

        const imageShift = lerp(viewport * 0.035, 0, entry) + lerp(0, -viewport * 0.2, exit);
        const imageScale = lerp(1.06, 1.015, settle) + exit * 0.035;
        const imageOpacity = lerp(1, 0.32, exit);
        const copyShift = lerp(42, 0, entry) + lerp(0, -50, exit);
        const copyOpacity = entry * (1 - exit);
        const washOpacity = 0.08 + settle * 0.11 + exit * 0.08;

        panel.style.setProperty('--feature-shift', `${Math.round(imageShift)}px`);
        panel.style.setProperty('--feature-scale', imageScale.toFixed(4));
        panel.style.setProperty('--feature-opacity', imageOpacity.toFixed(3));
        panel.style.setProperty('--feature-copy-shift', `${Math.round(copyShift)}px`);
        panel.style.setProperty('--feature-copy-opacity', copyOpacity.toFixed(3));
        panel.style.setProperty('--feature-wash-opacity', washOpacity.toFixed(3));
        panel.style.setProperty('--feature-progress-width', `${(progress * 100).toFixed(2)}%`);
    }

    function initFlowEffects() {
        if (!cinemaHero && !featurePanels.length) return;

        let frame = 0;

        const update = () => {
            frame = 0;
            updateHeroFlow();
            featurePanels.forEach(updateFeatureFlow);
        };

        const requestUpdate = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(update);
        };

        window.addEventListener('scroll', requestUpdate, { passive: true });
        window.addEventListener('resize', requestUpdate, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) requestUpdate();
        });

        update();
        root.classList.add('home-flow-ready');
    }

    async function initWebGpuTexture() {
        const canvas = root.querySelector('[data-home-gpu]');
        if (!canvas || reduceMotion() || !('gpu' in navigator)) return;
        if (navigator.connection?.saveData) return;
        if (navigator.deviceMemory && navigator.deviceMemory < 4) return;

        const stage = canvas.closest('.home-cinema-stage');
        if (!stage) return;

        try {
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
            if (!adapter) return;

            const device = await adapter.requestDevice();
            const context = canvas.getContext('webgpu');
            if (!context) return;

            const format = navigator.gpu.getPreferredCanvasFormat();
            const shader = device.createShaderModule({
                code: `
struct Uniforms {
    time: f32,
    speed: f32,
    pointerX: f32,
    pointerY: f32,
    width: f32,
    height: f32,
    scroll: f32,
    pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
    var positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let size = max(vec2f(u.width, u.height), vec2f(1.0));
    let uv = position.xy / size;
    let cell = floor(position.xy * 0.18 + vec2f(u.scroll * 0.018, 0.0));
    let grain = hash2(cell + floor(u.time * 11.0));
    let scan = step(0.86, fract(position.y * 0.19 + u.time * 1.9));
    let diagonal = step(0.965, fract((position.x + position.y * 0.55) * 0.045 + u.scroll * 0.002));
    let pointer = 1.0 - smoothstep(0.05, 0.55, distance(uv, vec2f(u.pointerX, u.pointerY)));
    let pulse = 0.5 + 0.5 * sin(u.time * 2.2 + uv.y * 9.0);

    let distortion = clamp(0.03 + u.speed * 0.17 + pointer * 0.025, 0.03, 0.22);
    let mark = grain * 0.4 + scan * 0.33 + diagonal * 0.4 + pulse * 0.05;
    let pinkBias = step(0.78, grain + pointer * 0.12);
    let cyanBias = step(0.91, fract(grain * 1.73 + uv.x * 0.31));

    let ink = mix(vec3f(0.01, 0.01, 0.02), vec3f(0.95, 0.03, 0.48), pinkBias * 0.5);
    let color = mix(ink, vec3f(0.0, 0.63, 0.72), cyanBias * 0.24);
    let alpha = clamp(mark * distortion, 0.0, 0.16);

    return vec4f(color, alpha);
}
`
            });

            const pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module: shader, entryPoint: 'vs' },
                fragment: {
                    module: shader,
                    entryPoint: 'fs',
                    targets: [{
                        format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: { topology: 'triangle-list' }
            });

            const uniformBuffer = device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            const bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });

            const pointer = { x: 0.5, y: 0.5 };
            let scrollSpeed = 0;
            let lastScrollY = window.scrollY;
            let lastScrollTime = performance.now();
            let settleTimer = 0;
            let active = false;
            let running = false;
            let lastFrame = 0;

            const resize = () => {
                const rect = stage.getBoundingClientRect();
                const scale = rect.width < 700 ? 0.32 : 0.46;
                canvas.width = Math.max(1, Math.min(1050, Math.floor(rect.width * scale)));
                canvas.height = Math.max(1, Math.min(720, Math.floor(rect.height * scale)));
                context.configure({ device, format, alphaMode: 'premultiplied' });
            };

            const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
            resizeObserver?.observe(stage);
            window.addEventListener('resize', resize, { passive: true });
            resize();

            root.addEventListener('pointermove', event => {
                pointer.x = clamp(event.clientX / Math.max(window.innerWidth, 1));
                pointer.y = clamp(event.clientY / Math.max(window.innerHeight, 1));
            }, { passive: true });

            window.addEventListener('scroll', () => {
                const now = performance.now();
                const deltaY = Math.abs(window.scrollY - lastScrollY);
                const deltaTime = Math.max(16, now - lastScrollTime);
                scrollSpeed = Math.min(1, (deltaY / deltaTime) * 0.48);
                lastScrollY = window.scrollY;
                lastScrollTime = now;
                window.clearTimeout(settleTimer);
                settleTimer = window.setTimeout(() => {
                    scrollSpeed = 0;
                }, 150);
            }, { passive: true });

            const frame = now => {
                if (!active || document.hidden || reduceMotion()) {
                    running = false;
                    return;
                }

                if (now - lastFrame < 32) {
                    window.requestAnimationFrame(frame);
                    return;
                }
                lastFrame = now;

                device.queue.writeBuffer(
                    uniformBuffer,
                    0,
                    new Float32Array([
                        now / 1000,
                        scrollSpeed,
                        pointer.x,
                        pointer.y,
                        canvas.width,
                        canvas.height,
                        window.scrollY,
                        0
                    ])
                );

                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: context.getCurrentTexture().createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }]
                });
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();
                device.queue.submit([encoder.finish()]);
                window.requestAnimationFrame(frame);
            };

            const start = () => {
                if (running || !active || document.hidden || reduceMotion()) return;
                running = true;
                window.requestAnimationFrame(frame);
            };

            if ('IntersectionObserver' in window) {
                const observer = new IntersectionObserver(entries => {
                    active = entries.some(entry => entry.isIntersecting);
                    if (active) start();
                }, { rootMargin: '15% 0px', threshold: 0.01 });
                observer.observe(stage);
            } else {
                active = true;
            }

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) start();
            });

            root.classList.add('has-webgpu');
            start();

            device.lost.then(() => {
                root.classList.remove('has-webgpu');
                active = false;
                running = false;
                resizeObserver?.disconnect();
            }).catch(() => {});
        } catch {
            root.classList.remove('has-webgpu');
        }
    }

    initFlowEffects();

    if (document.readyState === 'complete') startDeferredLoads();
    else window.addEventListener('load', startDeferredLoads, { once: true });
})();
