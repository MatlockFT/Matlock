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
        .prediction-button:disabled{cursor:wait;opacity:.58}
        .upcoming-event-card.is-exporting .fighter:hover::after,.upcoming-event-card.is-exporting .fighter:focus-visible::after{border-color:transparent}
        .upcoming-event-card.is-exporting .fighter.${PICK}::after{border-color:#37e66b}
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
            if (fighter) { fighter.classList.add(PICK); fighter.setAttribute("aria-pressed", "true"); }
        });
        updateStatus(card, status);
    };

    const choose = (card, fighter, status) => {
        const bout = fighter.closest(".bout-card");
        if (!bout) return;
        const wasPicked = fighter.classList.contains(PICK);
        bout.querySelectorAll(".fighter").forEach(item => { item.classList.remove(PICK); item.setAttribute("aria-pressed", "false"); });
        if (!wasPicked) { fighter.classList.add(PICK); fighter.setAttribute("aria-pressed", "true"); }
        save(card);
        updateStatus(card, status);
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

    const localizeImages = async card => {
        const restoreImages = [];
        await Promise.all([...card.querySelectorAll("img[data-fighter-photo]")].map(async image => {
            const original = image.currentSrc || image.src;
            if (!original || original.startsWith("data:") || original.startsWith(location.origin)) return;
            const localized = await exportableSrc(original);
            if (!localized) return;
            restoreImages.push([image, image.src]);
            image.src = localized;
            try { await image.decode(); } catch {}
        }));
        return () => restoreImages.forEach(([image, src]) => { image.src = src; });
    };

    const download = async (card, button) => {
        const label = button.textContent;
        let restoreImages = () => {};
        button.disabled = true;
        button.textContent = "Building JPEG...";
        card.classList.add("is-exporting");
        try {
            const html2canvas = await loadExporter();
            if (document.fonts?.ready) await document.fonts.ready;
            restoreImages = await localizeImages(card);
            const canvas = await html2canvas(card, { backgroundColor: "#080808", scale: Math.max(2, devicePixelRatio || 1), useCORS: true, allowTaint: false, logging: false, imageTimeout: 20000 });
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
            restoreImages();
            card.classList.remove("is-exporting");
            button.disabled = false;
        }
    };

    document.querySelectorAll(".upcoming-event-card").forEach(card => {
        const actions = document.createElement("div");
        actions.className = "prediction-actions";
        const status = document.createElement("p");
        status.className = "prediction-status";
        status.setAttribute("aria-live", "polite");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "prediction-button";
        button.textContent = "Download Picks as JPEG";
        actions.append(status, button);
        card.insertAdjacentElement("afterend", actions);
        button.addEventListener("click", () => download(card, button));

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