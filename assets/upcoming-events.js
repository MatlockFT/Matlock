(() => {
    const page = document.querySelector(".upcoming-events-page");
    const eventList = page?.querySelector(".upcoming-events-list");
    if (!page || !eventList) return;

    const PICK = "is-pick";
    const H2C = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    const assetQuery = (() => {
        try { return new URL(document.currentScript?.src || "", location.href).search; }
        catch { return ""; }
    })();

    const slug = text => (text || "fight-card")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const fighterName = fighter => fighter.querySelector(".fighter-name")?.textContent?.trim() || "fighter";
    const boutKey = bout => bout.querySelector(".bout-label span")?.textContent?.trim() || "bout";
    const storeKey = card => `mma-matlock-picks:${card.querySelector("time")?.getAttribute("datetime") || "date"}:${slug(card.querySelector("h2")?.textContent)}`;

    const normalizeFighterName = value => (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const cards = [...eventList.querySelectorAll(":scope > .upcoming-event-card")];
    cards
        .sort((a, b) => {
            const aDate = a.querySelector("time[datetime]")?.getAttribute("datetime") || "9999-12-31";
            const bDate = b.querySelector("time[datetime]")?.getAttribute("datetime") || "9999-12-31";
            return aDate.localeCompare(bDate);
        })
        .forEach(card => eventList.appendChild(card));

    const sherdogOriginalUrl = src => {
        if (!/sherdog\.com\/image_crop\/\d+\/\d+\//i.test(src)) return "";
        return src.replace(/\/image_crop\/\d+\/\d+\//i, "/");
    };

    const markPortraitFraming = image => {
        if (!image?.naturalWidth || !image?.naturalHeight) return;
        const card = image.closest(".upcoming-event-card");
        const regional = card?.dataset.regional === "true";
        const ratio = image.naturalWidth / image.naturalHeight;
        const framing = image.dataset.portraitFraming || "standard";
        const source = image.dataset.portraitSource || "";
        const src = image.currentSrc || image.src || "";
        const standardEspn = source === "espn" || /a\.espncdn\.com\/i\/headshots\/mma\/players\/full\//i.test(src);
        const extremeRatio = ratio < .46 || ratio > 1.75;
        const safe = regional || framing === "safe" || extremeRatio || !standardEspn;
        image.dataset.portraitSafe = safe ? "true" : "false";
    };

    const probeRegionalOriginal = image => {
        const card = image.closest(".upcoming-event-card");
        if (card?.dataset.regional !== "true" || image.dataset.originalProbe === "done") return;
        image.dataset.originalProbe = "done";

        const current = image.currentSrc || image.src || "";
        const candidate = sherdogOriginalUrl(current);
        if (!candidate || candidate === current) return;

        const probe = new Image();
        probe.referrerPolicy = "no-referrer";
        probe.decoding = "async";
        probe.onload = () => {
            if (probe.naturalWidth < 80 || probe.naturalHeight < 80) return;
            image.src = candidate;
            image.dataset.portraitSource = "sherdog-original";
        };
        probe.src = candidate;
    };

    const preparePortrait = image => {
        const frame = image.closest(".fighter-photo");
        if (!frame || image.dataset.portraitPrepared === "true") return;
        image.dataset.portraitPrepared = "true";

        const fail = () => {
            frame.classList.add("photo-missing");
            image.remove();
        };
        const ready = () => {
            frame.classList.remove("photo-missing");
            markPortraitFraming(image);
            probeRegionalOriginal(image);
        };

        image.addEventListener("load", ready);
        image.addEventListener("error", fail, { once: true });
        if (image.complete) {
            if (image.naturalWidth > 0) ready();
            else fail();
        }
    };

    eventList.querySelectorAll("img[data-fighter-photo]").forEach(preparePortrait);

    fetch(`/assets/fighter-portraits.json${assetQuery}`, { cache: "default" })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(portraits => {
            eventList.querySelectorAll(".fighter").forEach(fighter => {
                const name = fighter.querySelector(".fighter-name")?.textContent?.trim();
                const hit = portraits[normalizeFighterName(name)];
                const frame = fighter.querySelector(".fighter-photo");
                if (!hit?.url || !frame) return;

                let image = frame.querySelector("img[data-fighter-photo]");
                if (!image) {
                    image = document.createElement("img");
                    image.setAttribute("data-fighter-photo", "");
                    image.alt = name || "Fighter portrait";
                    image.loading = fighter.closest(".bout-card-featured") ? "eager" : "lazy";
                    image.decoding = "async";
                    image.referrerPolicy = "no-referrer";
                    frame.appendChild(image);
                }

                image.dataset.portraitSource = hit.source || image.dataset.portraitSource || "cache";
                image.dataset.portraitFraming = hit.framing || image.dataset.portraitFraming || "standard";

                if (!image.src || frame.classList.contains("photo-missing")) {
                    image.src = hit.url;
                }
                preparePortrait(image);
            });
        })
        .catch(() => {});

    const updateStatus = (card, status) => {
        const picked = card.querySelectorAll(`.fighter.${PICK}`).length;
        const fights = card.querySelectorAll(".bout-card").length;
        status.textContent = `${picked} of ${fights} fights picked`;
    };

    const save = card => {
        const picks = {};
        card.querySelectorAll(".bout-card").forEach(bout => {
            const pick = bout.querySelector(`.fighter.${PICK}`);
            if (pick) picks[boutKey(bout)] = fighterName(pick);
        });
        try { localStorage.setItem(storeKey(card), JSON.stringify(picks)); } catch {}
    };

    const restore = (card, status) => {
        let picks = {};
        try { picks = JSON.parse(localStorage.getItem(storeKey(card)) || "{}"); } catch {}

        card.querySelectorAll(".bout-card").forEach(bout => {
            const name = picks[boutKey(bout)];
            if (!name) return;
            const fighter = [...bout.querySelectorAll(".fighter")].find(item => fighterName(item) === name);
            if (!fighter) return;
            fighter.classList.add(PICK);
            fighter.setAttribute("aria-pressed", "true");
        });
        updateStatus(card, status);
    };

    const choose = (card, fighter, status) => {
        const bout = fighter.closest(".bout-card");
        if (!bout) return;
        const wasPicked = fighter.classList.contains(PICK);

        bout.querySelectorAll(".fighter").forEach(item => {
            item.classList.remove(PICK);
            item.setAttribute("aria-pressed", "false");
        });

        if (!wasPicked) {
            fighter.classList.add(PICK);
            fighter.setAttribute("aria-pressed", "true");
        }
        save(card);
        updateStatus(card, status);
    };

    const clearPicks = (card, status, button) => {
        card.querySelectorAll(`.fighter.${PICK}`).forEach(fighter => {
            fighter.classList.remove(PICK);
            fighter.setAttribute("aria-pressed", "false");
        });
        try { localStorage.removeItem(storeKey(card)); } catch {}
        updateStatus(card, status);

        const label = button.textContent;
        button.textContent = "Picks Cleared";
        setTimeout(() => { button.textContent = label; }, 1200);
    };

    const loadExporter = () => window.html2canvas
        ? Promise.resolve(window.html2canvas)
        : new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = H2C;
            script.crossOrigin = "anonymous";
            script.onload = () => resolve(window.html2canvas);
            script.onerror = () => reject(new Error("Could not load JPEG exporter"));
            document.head.appendChild(script);
        });

    const toDataUrl = blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

    const exportableSrc = async src => {
        for (const url of [src, `https://images.weserv.nl/?url=${encodeURIComponent(src)}`]) {
            try {
                const response = await fetch(url, { mode: "cors", cache: "force-cache" });
                if (response.ok) return await toDataUrl(await response.blob());
            } catch {}
        }
        return null;
    };

    const loadImage = src => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });

    const hashSeed = text => {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    };

    const seededRandom = initialSeed => {
        let seed = initialSeed >>> 0;
        return () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    };

    const distressPortrait = (ctx, width, height, seedText) => {
        const rand = seededRandom(hashSeed(seedText || "fighter"));
        const specks = Math.max(260, Math.round(width * height * .055));

        ctx.save();
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-over";

        for (let i = 0; i < specks; i += 1) {
            const x = rand() * width;
            const y = rand() * height;
            const size = .25 + rand() * 1.15;
            const alpha = .025 + rand() * .07;
            ctx.fillStyle = rand() > .47
                ? `rgba(255,255,255,${alpha})`
                : `rgba(0,0,0,${alpha * 1.35})`;
            ctx.fillRect(x, y, size, size);
        }

        for (let i = 0; i < 11; i += 1) {
            const y = rand() * height;
            const thickness = .35 + rand() * 1.25;
            const alpha = .018 + rand() * .045;
            ctx.fillStyle = rand() > .55
                ? `rgba(255,255,255,${alpha})`
                : `rgba(0,0,0,${alpha * 1.4})`;
            ctx.fillRect(0, y, width, thickness);
        }

        ctx.lineCap = "round";
        const scratchCount = Math.max(7, Math.round(width / 13));
        for (let i = 0; i < scratchCount; i += 1) {
            const x1 = rand() * width;
            const y1 = rand() * height;
            const length = 8 + rand() * Math.min(42, height * .42);
            const drift = -12 + rand() * 24;
            ctx.beginPath();
            ctx.strokeStyle = rand() > .42
                ? `rgba(255,255,255,${.055 + rand() * .075})`
                : `rgba(0,0,0,${.08 + rand() * .09})`;
            ctx.lineWidth = .35 + rand() * 1.05;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + drift, Math.min(height, y1 + length));
            ctx.stroke();
        }

        for (let i = 0; i < 8; i += 1) {
            const x = rand() * width;
            const y = rand() * height;
            const w = 1.2 + rand() * 4;
            const h = .5 + rand() * 2.2;
            ctx.fillStyle = rand() > .5
                ? `rgba(255,255,255,${.045 + rand() * .055})`
                : `rgba(0,0,0,${.10 + rand() * .08})`;
            ctx.fillRect(x, y, w, h);
        }
        ctx.restore();
    };

    const positionPercent = value => {
        const match = String(value || "").match(/(-?\d+(?:\.\d+)?)%/g) || [];
        return {
            x: Math.max(0, Math.min(1, parseFloat(match[0] || "50") / 100)),
            y: Math.max(0, Math.min(1, parseFloat(match[1] || "50") / 100))
        };
    };

    const rasterizePortraits = async card => {
        const cleanups = [];
        const images = [...card.querySelectorAll("img[data-fighter-photo]")];

        await Promise.all(images.map(async image => {
            const frame = image.closest(".fighter-photo");
            if (!frame) return;

            const localized = await exportableSrc(image.currentSrc || image.src);
            if (!localized) return;

            let source;
            try {
                source = await loadImage(localized);
                if (source.decode) {
                    try { await source.decode(); } catch {}
                }
            } catch {
                return;
            }

            const frameRect = frame.getBoundingClientRect();
            const imageRect = image.getBoundingClientRect();
            if (!frameRect.width || !frameRect.height || !imageRect.width || !imageRect.height) return;

            const rasterScale = 3;
            const canvas = document.createElement("canvas");
            canvas.className = "export-portrait-canvas";
            canvas.width = Math.max(1, Math.round(frameRect.width * rasterScale));
            canvas.height = Math.max(1, Math.round(frameRect.height * rasterScale));
            canvas.style.width = `${frameRect.width}px`;
            canvas.style.height = `${frameRect.height}px`;

            const ctx = canvas.getContext("2d", { alpha: true });
            if (!ctx) return;
            ctx.scale(rasterScale, rasterScale);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.filter = "grayscale(1) contrast(1.32) brightness(.9)";

            const sourceWidth = source.naturalWidth || source.width;
            const sourceHeight = source.naturalHeight || source.height;
            const fitScale = Math.min(imageRect.width / sourceWidth, imageRect.height / sourceHeight);
            const drawWidth = sourceWidth * fitScale;
            const drawHeight = sourceHeight * fitScale;
            const freeX = imageRect.width - drawWidth;
            const freeY = imageRect.height - drawHeight;
            const pos = positionPercent(getComputedStyle(image).objectPosition);
            const drawX = (imageRect.left - frameRect.left) + freeX * pos.x;
            const drawY = (imageRect.top - frameRect.top) + freeY * pos.y;

            ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
            distressPortrait(ctx, frameRect.width, frameRect.height, fighterName(frame.closest(".fighter")));

            frame.appendChild(canvas);
            cleanups.push(() => canvas.remove());
        }));

        return () => cleanups.forEach(cleanup => cleanup());
    };

    const download = async (card, button) => {
        const label = button.textContent;
        let clearPortraitCanvases = () => {};
        button.disabled = true;
        button.textContent = "Building JPEG...";

        try {
            const html2canvas = await loadExporter();
            if (document.fonts?.ready) await document.fonts.ready;

            clearPortraitCanvases = await rasterizePortraits(card);
            card.classList.add("is-exporting");
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const canvas = await html2canvas(card, {
                backgroundColor: "#080808",
                scale: Math.max(2, devicePixelRatio || 1),
                useCORS: true,
                allowTaint: false,
                logging: false,
                imageTimeout: 20000
            });

            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .95));
            if (!blob) throw new Error("JPEG creation failed");

            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${slug(card.querySelector("h2")?.textContent)}-picks.jpg`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            button.textContent = "JPEG Saved";
            setTimeout(() => { button.textContent = label; }, 1600);
        } catch (error) {
            console.error("Fight card export failed:", error);
            button.textContent = "Export Failed — Try Again";
            setTimeout(() => { button.textContent = label; }, 2400);
        } finally {
            card.classList.remove("is-exporting");
            clearPortraitCanvases();
            button.disabled = false;
        }
    };

    cards.forEach(card => {
        const note = card.querySelector(".event-card-note");
        if (note) {
            note.classList.add("event-card-disclaimer");
            card.insertAdjacentElement("afterend", note);
        }

        const actions = document.createElement("div");
        actions.className = "prediction-actions";

        const status = document.createElement("p");
        status.className = "prediction-status";
        status.setAttribute("aria-live", "polite");

        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.className = "prediction-button";
        downloadButton.textContent = "Download Picks as JPEG";

        const clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className = "prediction-button prediction-button-clear";
        clearButton.textContent = "Clear Picks";

        actions.append(status, downloadButton, clearButton);
        note ? note.insertAdjacentElement("afterend", actions) : card.insertAdjacentElement("afterend", actions);

        downloadButton.addEventListener("click", () => download(card, downloadButton));
        clearButton.addEventListener("click", () => clearPicks(card, status, clearButton));

        card.querySelectorAll(".bout-card .fighter").forEach(fighter => {
            fighter.setAttribute("role", "button");
            fighter.setAttribute("tabindex", "0");
            fighter.setAttribute("aria-pressed", "false");
            fighter.setAttribute("aria-label", `Pick ${fighterName(fighter)} to win`);
            fighter.addEventListener("click", () => choose(card, fighter, status));
            fighter.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                choose(card, fighter, status);
            });
        });

        restore(card, status);
    });
})();
