(() => {
    const PICK = "is-pick";
    const H2C = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

    const style = document.createElement("style");
    style.textContent = `
        .upcoming-event-card .fighter{cursor:pointer;outline:none}
        .upcoming-event-card .fighter::after{position:absolute;inset:0;z-index:6;border:3px solid transparent;background:transparent;content:"";pointer-events:none;transition:.12s ease}
        .upcoming-event-card .fighter:hover::after,.upcoming-event-card .fighter:focus-visible::after{border-color:rgba(255,255,255,.5)}
        .upcoming-event-card .fighter.${PICK}::after{border-color:#37e66b;background:rgba(34,205,88,.17);box-shadow:inset 0 0 0 1px rgba(196,255,211,.72),inset 0 0 28px rgba(34,205,88,.12)}
        .upcoming-event-card .fighter.${PICK} .fighter-name{background:#0d2113;color:#e9ffef}
        .prediction-actions{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.5rem;margin-top:.7rem}
        .prediction-status{width:100%;margin:0;color:#aaa;font:700 .62rem "Courier New",monospace;letter-spacing:.05em;text-align:center;text-transform:uppercase}
        .prediction-button{appearance:none;border:1px solid #fff;border-radius:0;padding:.55rem .8rem;background:#fff;color:#000;cursor:pointer;font:700 .64rem "Courier New",monospace;letter-spacing:.04em;line-height:1;text-transform:uppercase}
        .prediction-button:hover,.prediction-button:focus-visible{background:#ddd}
        .prediction-button-clear{border-color:#686868;background:transparent;color:#fff}
        .prediction-button-clear:hover,.prediction-button-clear:focus-visible{border-color:#fff;background:#151515;color:#fff}
        .prediction-button:disabled{cursor:wait;opacity:.58}
        .event-card-disclaimer{margin:.42rem 0 0!important;padding:.08rem .15rem 0!important;border:0!important;background:transparent!important}
        .event-card-disclaimer p{margin:0!important;color:#777!important;font:400 .52rem "Courier New",monospace!important;line-height:1.35;text-align:center}
        .upcoming-event-card.is-exporting .fighter:hover::after,.upcoming-event-card.is-exporting .fighter:focus-visible::after{border-color:transparent}
        .upcoming-event-card.is-exporting .fighter.${PICK}::after{border-color:#37e66b}
        .fighter-photo .export-portrait-canvas{position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:none}
        .upcoming-event-card.is-exporting .fighter-photo img[data-fighter-photo]{visibility:hidden!important}
    `;
    document.head.appendChild(style);

    document.querySelectorAll("[data-fighter-photo]").forEach(image => {
        const frame = image.closest(".fighter-photo");
        if (!frame) return;
        const fallback = () => { frame.classList.add("photo-missing"); image.remove(); };
        image.addEventListener("error", fallback, { once: true });
        if (image.complete && image.naturalWidth === 0) fallback();
    });

    const slug = text => (text || "fight-card").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const fighterName = fighter => fighter.querySelector(".fighter-name")?.textContent?.trim() || "fighter";
    const boutKey = bout => bout.querySelector(".bout-label span")?.textContent?.trim() || "bout";
    const storeKey = card => `mma-matlock-picks:${card.querySelector("time")?.getAttribute("datetime") || "date"}:${slug(card.querySelector("h2")?.textContent)}`;

    const updateStatus = (card, status) => {
        status.textContent = `${card.querySelectorAll(`.fighter.${PICK}`).length} of ${card.querySelectorAll(".bout-card").length} fights picked`;
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
            if (fighter) {
                fighter.classList.add(PICK);
                fighter.setAttribute("aria-pressed", "true");
            }
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

    const loadExporter = () => window.html2canvas ? Promise.resolve(window.html2canvas) : new Promise((resolve, reject) => {
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

    const rasterizePortraits = async card => {
        const cleanups = [];
        const images = [...card.querySelectorAll("img[data-fighter-photo]")];

        await Promise.all(images.map(async image => {
            const frame = image.closest(".fighter-photo");
            if (!frame) return;

            const originalSrc = image.currentSrc || image.src;
            const localized = await exportableSrc(originalSrc);
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
            ctx.filter = "grayscale(1) contrast(1.1)";

            const sourceWidth = source.naturalWidth || source.width;
            const sourceHeight = source.naturalHeight || source.height;
            const fitScale = Math.min(imageRect.width / sourceWidth, imageRect.height / sourceHeight);
            const drawWidth = sourceWidth * fitScale;
            const drawHeight = sourceHeight * fitScale;
            const drawX = (imageRect.left - frameRect.left) + ((imageRect.width - drawWidth) / 2);
            const drawY = (imageRect.top - frameRect.top) + (imageRect.height - drawHeight);

            ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
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

            // Bake the live on-screen portrait crop into temporary canvases first.
            // html2canvas then captures ordinary pixels instead of CSS-transformed images.
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

    document.querySelectorAll(".upcoming-event-card").forEach(card => {
        const disclaimer = card.querySelector(".event-card-note");
        if (disclaimer) {
            disclaimer.classList.add("event-card-disclaimer");
            card.insertAdjacentElement("afterend", disclaimer);
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
        card.insertAdjacentElement("afterend", actions);

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