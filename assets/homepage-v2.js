(() => {
    const root = document.querySelector('[data-home-dashboard]');
    if (!root) return;

    const newsList = root.querySelector('[data-home-news-list]');
    const otdBody = root.querySelector('[data-home-otd-body]');
    const rosterBody = root.querySelector('[data-home-roster-body]');
    const immersiveSequence = root.querySelector('[data-immersive-sequence]');
    const immersiveStage = root.querySelector('[data-immersive-stage]');
    const immersiveSlides = [...root.querySelectorAll('[data-immersive-slide]')];
    const sceneCounter = root.querySelector('[data-scene-counter]');
    const sceneHint = root.querySelector('[data-scene-hint]');
    const navSceneCounter = document.querySelector('[data-nav-scene-counter]');
    const navSceneTitle = document.querySelector('[data-nav-scene-title]');
    const immersiveEdge = root.querySelector('.home-immersive-edge');

    const liveNewsUrl = root.dataset.newsUrl;
    const fallbackNewsUrl = root.dataset.newsFallbackUrl;
    const historyUrl = root.dataset.historyUrl;
    const historyRuntimeBase = root.dataset.historyRuntimeBase;
    const rosterUrl = root.dataset.rosterUrl;
    const historyTimeZone = 'America/Chicago';

    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
    const lerp = (start, end, amount) => start + (end - start) * amount;
    const smooth = value => {
        const t = clamp(value);
        return t * t * (3 - 2 * t);
    };

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
                        { opacity: 0, transform: 'translate3d(-22px, 0, 0)' },
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

    function setSlideState(slide, {
        opacity,
        y,
        scale,
        copyOpacity,
        copyY,
        inkOpacity,
        shadeBottom,
        z
    }) {
        slide.style.setProperty('--scene-opacity', opacity.toFixed(4));
        slide.style.setProperty('--scene-y', `${y.toFixed(2)}vh`);
        slide.style.setProperty('--scene-scale', scale.toFixed(4));
        slide.style.setProperty('--copy-opacity', copyOpacity.toFixed(4));
        slide.style.setProperty('--copy-y', `${copyY.toFixed(2)}px`);
        slide.style.setProperty('--ink-opacity', inkOpacity.toFixed(4));
        slide.style.setProperty('--shade-bottom', shadeBottom.toFixed(4));
        slide.style.setProperty('--scene-z', String(z));
    }

    function initImmersiveFlow() {
        if (!immersiveSequence || !immersiveStage || !immersiveSlides.length) return;

        immersiveSlides.forEach((slide, index) => {
            slide.style.setProperty('--scene-z', String(index));
        });

        const motionReduced = reduceMotion();
        let raf = 0;
        let lastActive = -1;
        let visualSceneFloat = 0;
        let springVelocity = 0;

        const measuredSceneFloat = () => {
            const rect = immersiveSequence.getBoundingClientRect();
            const viewport = Math.max(window.innerHeight, 1);
            const travel = Math.max(1, immersiveSequence.offsetHeight - viewport);
            const scrollPx = clamp(-rect.top, 0, travel);
            return scrollPx / viewport;
        };

        const render = () => {
            raf = 0;

            const targetSceneFloat = measuredSceneFloat();
            const maxScene = immersiveSlides.length - 1;

            if (motionReduced) {
                visualSceneFloat = targetSceneFloat;
                springVelocity = 0;
            } else {
                const delta = targetSceneFloat - visualSceneFloat;
                springVelocity = (springVelocity + delta * .22) * .68;
                visualSceneFloat += springVelocity;

                if (Math.abs(delta) < .0007 && Math.abs(springVelocity) < .0007) {
                    visualSceneFloat = targetSceneFloat;
                    springVelocity = 0;
                }
            }

            const sceneFloat = visualSceneFloat;
            const boundedScene = clamp(sceneFloat, 0, maxScene);
            const activeIndex = Math.min(maxScene, Math.floor(boundedScene + .5));
            const momentum = motionReduced ? 0 : clamp(springVelocity * 7, -.32, .32);

            for (let i = 0; i < immersiveSlides.length; i += 1) {
                const slide = immersiveSlides[i];

                if (motionReduced) {
                    const isActive = i === activeIndex;
                    setSlideState(slide, {
                        opacity: isActive ? 1 : 0,
                        y: 0,
                        scale: 1,
                        copyOpacity: isActive ? 1 : 0,
                        copyY: 0,
                        inkOpacity: 0,
                        shadeBottom: .44,
                        z: i
                    });
                    slide.classList.toggle('is-active', isActive);
                    continue;
                }

                const incomingRaw = i === 0 ? 1 : clamp(sceneFloat - (i - 1), 0, 1);
                const incoming = i === 0 ? 1 : smooth(incomingRaw);
                const nextRaw = i < maxScene ? clamp(sceneFloat - i, 0, 1) : 0;
                const next = smooth(nextRaw);

                const opacity = i === 0 ? 1 : incoming;
                const y = i === 0
                    ? momentum * -1.5
                    : lerp(9, 0, incoming) - momentum * 3.2;

                const scale = i === 0
                    ? 1 + next * .018 + Math.abs(momentum) * .018
                    : lerp(1.045, 1, incoming) + next * .012 + Math.abs(momentum) * .016;

                const copyIn = i === 0
                    ? 1
                    : smooth(clamp((incomingRaw - .3) / .44));

                const copyOut = i < maxScene
                    ? 1 - smooth(clamp((nextRaw - .2) / .5))
                    : 1;

                const copyOpacity = copyIn * copyOut;
                const copyY = lerp(22, 0, copyIn) + lerp(0, -20, 1 - copyOut) - momentum * 10;
                const inkOpacity = i === 0
                    ? 0
                    : Math.sin(incomingRaw * Math.PI) * (.38 + Math.abs(momentum) * .3);
                const shadeBottom = lerp(.34, .5, copyIn);

                setSlideState(slide, {
                    opacity,
                    y,
                    scale,
                    copyOpacity,
                    copyY,
                    inkOpacity,
                    shadeBottom,
                    z: i
                });

                slide.classList.toggle('is-active', i === activeIndex);
            }

            if (immersiveEdge) {
                if (motionReduced) {
                    immersiveEdge.style.setProperty('--edge-opacity', '0');
                } else {
                    const transitionIndex = Math.min(maxScene, Math.max(1, Math.ceil(boundedScene)));
                    const local = transitionIndex > 0
                        ? clamp(sceneFloat - (transitionIndex - 1), 0, 1)
                        : 0;
                    const wave = Math.sin(local * Math.PI);
                    immersiveEdge.style.setProperty(
                        '--edge-opacity',
                        clamp(wave * .62 + Math.abs(momentum) * .3, 0, .86).toFixed(4)
                    );
                    immersiveEdge.style.setProperty(
                        '--edge-y',
                        `${lerp(88, -18, smooth(local)).toFixed(2)}vh`
                    );
                }
            }

            if (activeIndex !== lastActive) {
                const countText =
                    `${String(activeIndex + 1).padStart(2, '0')} / ${String(immersiveSlides.length).padStart(2, '0')}`;
                if (sceneCounter) sceneCounter.textContent = countText;
                if (navSceneCounter) navSceneCounter.textContent = countText;
                if (navSceneTitle) {
                    const currentTitle = immersiveSlides[activeIndex]?.querySelector('h2')?.textContent?.trim();
                    navSceneTitle.textContent = currentTitle || 'Latest stories';
                }
                lastActive = activeIndex;
            }

            if (sceneHint) {
                const hintOpacity = motionReduced ? 1 : 1 - smooth(clamp(targetSceneFloat / .55));
                sceneHint.style.opacity = hintOpacity.toFixed(3);
                if (motionReduced) sceneHint.textContent = 'SCROLL TO CHANGE STORY';
            }

            if (!motionReduced) {
                const delta = targetSceneFloat - visualSceneFloat;
                if (Math.abs(delta) >= .0007 || Math.abs(springVelocity) >= .0007) {
                    raf = window.requestAnimationFrame(render);
                }
            }
        };

        const requestUpdate = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(render);
        };

        window.addEventListener('scroll', requestUpdate, { passive: true });
        window.addEventListener('resize', requestUpdate, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) requestUpdate();
        });

        render();
        root.classList.add('home-flow-ready');
    }

    async function initWebGpuTexture() {
        const canvas = root.querySelector('[data-home-gpu]');
        if (!canvas || reduceMotion() || !('gpu' in navigator)) return;
        if (navigator.connection?.saveData) return;
        if (navigator.deviceMemory && navigator.deviceMemory < 4) return;
        if (!immersiveStage) return;

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

            const pointer = { x: .5, y: .5 };
            let scrollSpeed = 0;
            let lastScrollY = window.scrollY;
            let lastScrollTime = performance.now();
            let settleTimer = 0;
            let active = false;
            let running = false;
            let lastFrame = 0;

            const resize = () => {
                const rect = immersiveStage.getBoundingClientRect();
                const scale = rect.width < 700 ? .3 : .44;
                canvas.width = Math.max(1, Math.min(1024, Math.floor(rect.width * scale)));
                canvas.height = Math.max(1, Math.min(700, Math.floor(rect.height * scale)));
                context.configure({ device, format, alphaMode: 'premultiplied' });
            };

            const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
            resizeObserver?.observe(immersiveStage);
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
                scrollSpeed = Math.min(1, (deltaY / deltaTime) * .48);
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
                }, { rootMargin: '15% 0px', threshold: .01 });
                observer.observe(immersiveStage);
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

    initImmersiveFlow();

    if (document.readyState === 'complete') startDeferredLoads();
    else window.addEventListener('load', startDeferredLoads, { once: true });
})();
