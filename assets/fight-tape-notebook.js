(() => {
    "use strict";

    const root = document.querySelector("[data-tape-notebook]");

    if (!root) {
        return;
    }

    const STORAGE_KEY = "mmaMatlockFightTapeNotebook.v1";
    const DEFAULT_NOTEBOOK_NAME = "Untitled Fight Study";

    const elements = {
        notebookSelector: root.querySelector("#notebook-selector"),
        newNotebook: root.querySelector("[data-new-notebook]"),
        renameNotebook: root.querySelector("[data-rename-notebook]"),
        deleteNotebook: root.querySelector("[data-delete-notebook]"),

        fighterA: root.querySelector("#fighter-a"),
        fighterB: root.querySelector("#fighter-b"),
        event: root.querySelector("#fight-event"),
        scheduledRounds: root.querySelector("#scheduled-rounds"),
        videoUrl: root.querySelector("#video-url"),
        localVideo: root.querySelector("#local-video"),
        loadVideo: root.querySelector("[data-load-video]"),

        videoStage: root.querySelector("[data-video-stage]"),
        videoPlaceholder: root.querySelector("[data-video-placeholder]"),
        youtubePlayerElement: root.querySelector(
            "[data-youtube-player-host]"
        ),
        htmlVideo: root.querySelector("[data-html-video]"),
        currentTime: root.querySelector("[data-current-time]"),
        seekBack: root.querySelector("[data-seek-back]"),
        seekForward: root.querySelector("[data-seek-forward]"),
        useCurrentTime: root.querySelector("[data-use-current-time]"),

        noteForm: root.querySelector("[data-note-form]"),
        editingNoteId: root.querySelector("[data-editing-note-id]"),
        noteTime: root.querySelector("#note-time"),
        noteRound: root.querySelector("#note-round"),
        noteSide: root.querySelector("#note-side"),
        noteCategory: root.querySelector("#note-category"),
        noteText: root.querySelector("#note-text"),
        saveNote: root.querySelector("[data-save-note]"),
        cancelEdit: root.querySelector("[data-cancel-edit]"),

        noteCount: root.querySelector("[data-note-count]"),
        categoryCount: root.querySelector("[data-category-count]"),
        lastTimestamp: root.querySelector("[data-last-timestamp]"),

        copyMarkdown: root.querySelector("[data-copy-markdown]"),
        downloadMarkdown: root.querySelector("[data-download-markdown]"),
        downloadJson: root.querySelector("[data-download-json]"),
        importJson: root.querySelector("[data-import-json]"),
        importFile: root.querySelector("[data-import-file]"),

        clearNotes: root.querySelector("[data-clear-notes]"),
        noteSearch: root.querySelector("#note-search"),
        filterRound: root.querySelector("#filter-round"),
        filterSide: root.querySelector("#filter-side"),
        filterCategory: root.querySelector("#filter-category"),
        noteSort: root.querySelector("#note-sort"),
        emptyState: root.querySelector("[data-empty-state]"),
        noteList: root.querySelector("[data-note-list]"),
        status: root.querySelector("[data-notebook-status]")
    };

    let state = loadState();
    let youtubePlayer = null;
    let youtubeApiPromise = null;
    let localObjectUrl = null;
    let activeVideoType = null;
    let timeUpdateTimer = null;
    let statusTimer = null;

    function createId(prefix = "id") {
        if (window.crypto && window.crypto.randomUUID) {
            return `${prefix}-${window.crypto.randomUUID()}`;
        }

        return `${prefix}-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`;
    }

    function createNotebook(name = DEFAULT_NOTEBOOK_NAME) {
        return {
            id: createId("notebook"),
            name,
            fighterA: "",
            fighterB: "",
            event: "",
            scheduledRounds: 3,
            videoUrl: "",
            notes: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    function getDefaultState() {
        const notebook = createNotebook();

        return {
            activeId: notebook.id,
            notebooks: [notebook]
        };
    }

    function normalizeNotebook(notebook) {
        const normalized = {
            ...createNotebook(),
            ...notebook
        };

        normalized.scheduledRounds =
            Number(normalized.scheduledRounds) === 5 ? 5 : 3;

        normalized.notes = Array.isArray(normalized.notes)
            ? normalized.notes.map((note) => ({
                id: note.id || createId("note"),
                timestampSeconds: Number(note.timestampSeconds) || 0,
                round: String(note.round || "1"),
                side: note.side || "General",
                category: note.category || "Other",
                text: String(note.text || ""),
                createdAt: note.createdAt || new Date().toISOString(),
                updatedAt: note.updatedAt || note.createdAt ||
                    new Date().toISOString()
            }))
            : [];

        return normalized;
    }

    function loadState() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);

            if (!raw) {
                return getDefaultState();
            }

            const parsed = JSON.parse(raw);

            if (!parsed || !Array.isArray(parsed.notebooks)) {
                return getDefaultState();
            }

            const notebooks = parsed.notebooks.map(normalizeNotebook);

            if (notebooks.length === 0) {
                return getDefaultState();
            }

            const activeId = notebooks.some(
                (notebook) => notebook.id === parsed.activeId
            )
                ? parsed.activeId
                : notebooks[0].id;

            return {
                activeId,
                notebooks
            };
        } catch (error) {
            console.error(error);
            return getDefaultState();
        }
    }

    function saveState() {
        try {
            window.localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(state)
            );
        } catch (error) {
            console.error(error);
            showStatus("Notes could not be saved in this browser.");
        }
    }

    function getActiveNotebook() {
        let notebook = state.notebooks.find(
            (item) => item.id === state.activeId
        );

        if (!notebook) {
            notebook = state.notebooks[0];
            state.activeId = notebook.id;
        }

        return notebook;
    }

    function updateActiveNotebook(patch) {
        const notebook = getActiveNotebook();

        Object.assign(notebook, patch, {
            updatedAt: new Date().toISOString()
        });

        saveState();
    }

    function showStatus(message) {
        window.clearTimeout(statusTimer);
        elements.status.textContent = message;
        elements.status.classList.add("notebook-status-visible");

        statusTimer = window.setTimeout(() => {
            elements.status.classList.remove(
                "notebook-status-visible"
            );
        }, 2600);
    }

    function safeFileName(value, fallback = "fight-tape-notebook") {
        const cleaned = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        return cleaned || fallback;
    }

    function formatTimestamp(totalSeconds) {
        const safeSeconds = Math.max(
            0,
            Math.floor(Number(totalSeconds) || 0)
        );

        const hours = Math.floor(safeSeconds / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const seconds = safeSeconds % 60;

        if (hours > 0) {
            return [
                String(hours),
                String(minutes).padStart(2, "0"),
                String(seconds).padStart(2, "0")
            ].join(":");
        }

        return [
            String(minutes).padStart(2, "0"),
            String(seconds).padStart(2, "0")
        ].join(":");
    }

    function parseTimestamp(value) {
        const trimmed = String(value || "").trim();

        if (!trimmed) {
            return 0;
        }

        if (/^\d+(\.\d+)?$/.test(trimmed)) {
            return Math.max(0, Number(trimmed));
        }

        const parts = trimmed.split(":").map(Number);

        if (
            parts.some((part) => Number.isNaN(part)) ||
            parts.length < 2 ||
            parts.length > 3
        ) {
            return null;
        }

        if (parts.length === 2) {
            const [minutes, seconds] = parts;

            if (seconds >= 60) {
                return null;
            }

            return minutes * 60 + seconds;
        }

        const [hours, minutes, seconds] = parts;

        if (minutes >= 60 || seconds >= 60) {
            return null;
        }

        return hours * 3600 + minutes * 60 + seconds;
    }

    function getSideLabel(side, notebook = getActiveNotebook()) {
        if (side === "Fighter A") {
            return notebook.fighterA.trim() || "Fighter A";
        }

        if (side === "Fighter B") {
            return notebook.fighterB.trim() || "Fighter B";
        }

        return side;
    }

    function populateNotebookSelector() {
        elements.notebookSelector.textContent = "";

        state.notebooks.forEach((notebook) => {
            const option = document.createElement("option");
            option.value = notebook.id;
            option.textContent = notebook.name;
            option.selected = notebook.id === state.activeId;
            elements.notebookSelector.appendChild(option);
        });
    }

    function populateRoundOptions() {
        const notebook = getActiveNotebook();
        const currentNoteRound = elements.noteRound.value || "1";
        const currentFilterRound = elements.filterRound.value;

        elements.noteRound.textContent = "";
        elements.filterRound.textContent = "";

        const allRoundsOption = document.createElement("option");
        allRoundsOption.value = "";
        allRoundsOption.textContent = "All rounds";
        elements.filterRound.appendChild(allRoundsOption);

        for (
            let round = 1;
            round <= notebook.scheduledRounds;
            round += 1
        ) {
            const noteOption = document.createElement("option");
            noteOption.value = String(round);
            noteOption.textContent = `Round ${round}`;
            elements.noteRound.appendChild(noteOption);

            const filterOption = document.createElement("option");
            filterOption.value = String(round);
            filterOption.textContent = `Round ${round}`;
            elements.filterRound.appendChild(filterOption);
        }

        if (
            Number(currentNoteRound) <= notebook.scheduledRounds
        ) {
            elements.noteRound.value = currentNoteRound;
        }

        if (
            Number(currentFilterRound) <= notebook.scheduledRounds
        ) {
            elements.filterRound.value = currentFilterRound;
        }
    }

    function updateSideOptionLabels() {
        const notebook = getActiveNotebook();
        const options = elements.noteSide.options;

        if (options.length >= 2) {
            options[0].textContent =
                notebook.fighterA.trim() || "Fighter A";

            options[1].textContent =
                notebook.fighterB.trim() || "Fighter B";
        }

        const filterOptions = elements.filterSide.options;

        if (filterOptions.length >= 3) {
            filterOptions[1].textContent =
                notebook.fighterA.trim() || "Fighter A";

            filterOptions[2].textContent =
                notebook.fighterB.trim() || "Fighter B";
        }
    }

    function renderNotebookFields() {
        const notebook = getActiveNotebook();

        elements.fighterA.value = notebook.fighterA;
        elements.fighterB.value = notebook.fighterB;
        elements.event.value = notebook.event;
        elements.scheduledRounds.value =
            String(notebook.scheduledRounds);

        elements.videoUrl.value = notebook.videoUrl;

        populateRoundOptions();
        updateSideOptionLabels();
    }

    function getFilteredNotes() {
        const notebook = getActiveNotebook();
        const search = elements.noteSearch.value
            .trim()
            .toLowerCase();

        const round = elements.filterRound.value;
        const side = elements.filterSide.value;
        const category = elements.filterCategory.value;
        const sort = elements.noteSort.value;

        const filtered = notebook.notes.filter((note) => {
            const searchable = [
                note.text,
                note.category,
                getSideLabel(note.side, notebook),
                `Round ${note.round}`,
                formatTimestamp(note.timestampSeconds)
            ].join(" ").toLowerCase();

            return (
                (!search || searchable.includes(search)) &&
                (!round || note.round === round) &&
                (!side || note.side === side) &&
                (!category || note.category === category)
            );
        });

        filtered.sort((a, b) => {
            if (sort === "timestamp-desc") {
                return b.timestampSeconds - a.timestampSeconds;
            }

            if (sort === "created-desc") {
                return new Date(b.createdAt) - new Date(a.createdAt);
            }

            return a.timestampSeconds - b.timestampSeconds;
        });

        return filtered;
    }

    function createTag(text, className = "") {
        const tag = document.createElement("span");
        tag.className = `tape-note-tag ${className}`.trim();
        tag.textContent = text;
        return tag;
    }

    function renderNotes() {
        const notebook = getActiveNotebook();
        const notes = getFilteredNotes();

        elements.noteList.textContent = "";
        elements.emptyState.hidden = notes.length > 0;

        notes.forEach((note) => {
            const item = document.createElement("li");
            item.className = "tape-note";
            item.dataset.noteId = note.id;

            const timeButton = document.createElement("button");
            timeButton.className = "tape-note-time";
            timeButton.type = "button";
            timeButton.dataset.seekNote = note.id;
            timeButton.textContent = formatTimestamp(
                note.timestampSeconds
            );

            timeButton.setAttribute(
                "aria-label",
                `Seek video to ${formatTimestamp(
                    note.timestampSeconds
                )}`
            );

            const content = document.createElement("div");
            content.className = "tape-note-content";

            const tags = document.createElement("div");
            tags.className = "tape-note-tags";
            tags.appendChild(
                createTag(`Round ${note.round}`)
            );

            tags.appendChild(
                createTag(
                    getSideLabel(note.side, notebook),
                    "tape-note-subject"
                )
            );

            tags.appendChild(
                createTag(note.category)
            );

            const paragraph = document.createElement("p");
            paragraph.textContent = note.text;

            content.append(tags, paragraph);

            const actions = document.createElement("div");
            actions.className = "tape-note-actions";

            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.dataset.editNote = note.id;
            editButton.textContent = "Edit";

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.dataset.deleteNote = note.id;
            deleteButton.textContent = "Delete";

            actions.append(editButton, deleteButton);
            item.append(timeButton, content, actions);
            elements.noteList.appendChild(item);
        });

        const categories = new Set(
            notebook.notes.map((note) => note.category)
        );

        const lastTimestamp = notebook.notes.reduce(
            (latest, note) => Math.max(
                latest,
                note.timestampSeconds
            ),
            0
        );

        elements.noteCount.textContent =
            String(notebook.notes.length);

        elements.categoryCount.textContent =
            String(categories.size);

        elements.lastTimestamp.textContent =
            formatTimestamp(lastTimestamp);
    }

    function resetNoteForm() {
        elements.noteForm.reset();
        elements.editingNoteId.value = "";
        elements.saveNote.textContent = "Add note";
        elements.cancelEdit.hidden = true;
        elements.noteTime.value = formatTimestamp(
            getCurrentVideoTime()
        );

        populateRoundOptions();
        updateSideOptionLabels();
    }

    function renderAll() {
        populateNotebookSelector();
        renderNotebookFields();
        renderNotes();
        resetNoteForm();

        const notebook = getActiveNotebook();

        if (notebook.videoUrl) {
            loadVideoFromUrl(notebook.videoUrl, false);
        } else {
            resetVideoStage();
        }
    }

    function rebuildYouTubeHost() {
        const existingHost = root.querySelector(
            "[data-youtube-player-host]"
        );

        if (existingHost) {
            existingHost.remove();
        }

        const host = document.createElement("div");
        host.className = "youtube-player";
        host.id = `youtube-player-${Date.now()}`;
        host.dataset.youtubePlayerHost = "";
        host.hidden = true;

        elements.videoStage.insertBefore(
            host,
            elements.htmlVideo
        );

        elements.youtubePlayerElement = host;
    }

    function destroyActiveVideo() {
        window.clearInterval(timeUpdateTimer);
        timeUpdateTimer = null;

        if (
            youtubePlayer &&
            typeof youtubePlayer.destroy === "function"
        ) {
            youtubePlayer.destroy();
        }

        youtubePlayer = null;
        rebuildYouTubeHost();

        if (localObjectUrl) {
            URL.revokeObjectURL(localObjectUrl);
            localObjectUrl = null;
        }

        elements.htmlVideo.pause();
        elements.htmlVideo.removeAttribute("src");
        elements.htmlVideo.load();
        elements.htmlVideo.hidden = true;
        activeVideoType = null;
    }

    function resetVideoStage() {
        destroyActiveVideo();
        elements.videoPlaceholder.hidden = false;
        elements.currentTime.textContent = "00:00";
    }

    function parseYouTubeUrl(value) {
        try {
            const url = new URL(value);
            const host = url.hostname.replace(/^www\./, "");

            if (host === "youtu.be") {
                return url.pathname.split("/").filter(Boolean)[0] || null;
            }

            if (
                host === "youtube.com" ||
                host === "m.youtube.com"
            ) {
                if (url.pathname === "/watch") {
                    return url.searchParams.get("v");
                }

                const segments = url.pathname
                    .split("/")
                    .filter(Boolean);

                if (
                    ["embed", "shorts", "live"].includes(
                        segments[0]
                    )
                ) {
                    return segments[1] || null;
                }
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    function loadYouTubeApi() {
        if (
            window.YT &&
            typeof window.YT.Player === "function"
        ) {
            return Promise.resolve();
        }

        if (youtubeApiPromise) {
            return youtubeApiPromise;
        }

        youtubeApiPromise = new Promise((resolve, reject) => {
            const priorReady =
                window.onYouTubeIframeAPIReady;

            window.onYouTubeIframeAPIReady = () => {
                if (typeof priorReady === "function") {
                    priorReady();
                }

                resolve();
            };

            const existingScript = document.querySelector(
                'script[src="https://www.youtube.com/iframe_api"]'
            );

            if (existingScript) {
                existingScript.addEventListener(
                    "error",
                    reject,
                    { once: true }
                );

                return;
            }

            const script = document.createElement("script");
            script.src =
                "https://www.youtube.com/iframe_api";

            script.addEventListener(
                "error",
                reject,
                { once: true }
            );

            document.head.appendChild(script);
        });

        return youtubeApiPromise;
    }

    async function loadYouTubeVideo(videoId) {
        destroyActiveVideo();
        elements.videoPlaceholder.hidden = true;
        elements.youtubePlayerElement.hidden = false;
        activeVideoType = "youtube";

        try {
            await loadYouTubeApi();

            youtubePlayer = new window.YT.Player(
                elements.youtubePlayerElement,
                {
                    videoId,
                    playerVars: {
                        playsinline: 1,
                        rel: 0
                    },
                    events: {
                        onReady: () => {
                            startTimeUpdates();
                            showStatus("YouTube video loaded.");
                        }
                    }
                }
            );
        } catch (error) {
            console.error(error);
            resetVideoStage();
            showStatus("The YouTube player could not be loaded.");
        }
    }

    function loadDirectVideo(url) {
        destroyActiveVideo();
        elements.videoPlaceholder.hidden = true;
        elements.htmlVideo.hidden = false;
        elements.htmlVideo.src = url;
        activeVideoType = "html";
        elements.htmlVideo.load();
        startTimeUpdates();
        showStatus("Video loaded.");
    }

    function loadVideoFromUrl(value, save = true) {
        const trimmed = String(value || "").trim();

        if (!trimmed) {
            showStatus("Enter a video URL first.");
            return;
        }

        const youtubeId = parseYouTubeUrl(trimmed);

        if (save) {
            updateActiveNotebook({
                videoUrl: trimmed
            });
        }

        if (youtubeId) {
            loadYouTubeVideo(youtubeId);
            return;
        }

        try {
            new URL(trimmed);
            loadDirectVideo(trimmed);
        } catch (error) {
            showStatus("Enter a valid YouTube or video URL.");
        }
    }

    function loadLocalVideo(file) {
        if (!file) {
            return;
        }

        destroyActiveVideo();

        localObjectUrl = URL.createObjectURL(file);
        elements.videoPlaceholder.hidden = true;
        elements.htmlVideo.hidden = false;
        elements.htmlVideo.src = localObjectUrl;
        elements.htmlVideo.load();
        activeVideoType = "html";
        startTimeUpdates();

        showStatus(
            "Local video opened. It will not be stored in the notebook."
        );
    }

    function getCurrentVideoTime() {
        if (
            activeVideoType === "youtube" &&
            youtubePlayer &&
            typeof youtubePlayer.getCurrentTime === "function"
        ) {
            return Number(youtubePlayer.getCurrentTime()) || 0;
        }

        if (activeVideoType === "html") {
            return Number(elements.htmlVideo.currentTime) || 0;
        }

        return 0;
    }

    function seekVideo(seconds) {
        const safeSeconds = Math.max(0, Number(seconds) || 0);

        if (
            activeVideoType === "youtube" &&
            youtubePlayer &&
            typeof youtubePlayer.seekTo === "function"
        ) {
            youtubePlayer.seekTo(safeSeconds, true);

            if (typeof youtubePlayer.playVideo === "function") {
                youtubePlayer.playVideo();
            }
        } else if (activeVideoType === "html") {
            elements.htmlVideo.currentTime = safeSeconds;

            elements.htmlVideo.play().catch(() => {
                // User interaction requirements can block autoplay.
            });
        } else {
            showStatus("Load a video before seeking.");
            return;
        }

        elements.videoStage.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    function startTimeUpdates() {
        window.clearInterval(timeUpdateTimer);

        const update = () => {
            elements.currentTime.textContent =
                formatTimestamp(getCurrentVideoTime());
        };

        update();
        timeUpdateTimer = window.setInterval(update, 500);
    }

    function addOrUpdateNote(event) {
        event.preventDefault();

        const notebook = getActiveNotebook();
        const timestampSeconds = parseTimestamp(
            elements.noteTime.value
        );

        const text = elements.noteText.value.trim();

        if (timestampSeconds === null) {
            showStatus(
                "Use a timestamp such as 02:35 or 1:02:35."
            );

            elements.noteTime.focus();
            return;
        }

        if (!text) {
            showStatus("Write a note before saving.");
            elements.noteText.focus();
            return;
        }

        const editingId = elements.editingNoteId.value;
        const existingNote = notebook.notes.find(
            (note) => note.id === editingId
        );

        if (existingNote) {
            Object.assign(existingNote, {
                timestampSeconds,
                round: elements.noteRound.value,
                side: elements.noteSide.value,
                category: elements.noteCategory.value,
                text,
                updatedAt: new Date().toISOString()
            });

            showStatus("Note updated.");
        } else {
            notebook.notes.push({
                id: createId("note"),
                timestampSeconds,
                round: elements.noteRound.value,
                side: elements.noteSide.value,
                category: elements.noteCategory.value,
                text,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            showStatus("Tape note added.");
        }

        notebook.updatedAt = new Date().toISOString();
        saveState();
        renderNotes();
        resetNoteForm();
        elements.noteText.focus();
    }

    function editNote(noteId) {
        const notebook = getActiveNotebook();
        const note = notebook.notes.find(
            (item) => item.id === noteId
        );

        if (!note) {
            return;
        }

        elements.editingNoteId.value = note.id;
        elements.noteTime.value =
            formatTimestamp(note.timestampSeconds);

        elements.noteRound.value = note.round;
        elements.noteSide.value = note.side;
        elements.noteCategory.value = note.category;
        elements.noteText.value = note.text;
        elements.saveNote.textContent = "Update note";
        elements.cancelEdit.hidden = false;

        elements.noteText.focus();
        elements.noteForm.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    function deleteNote(noteId) {
        const notebook = getActiveNotebook();
        const note = notebook.notes.find(
            (item) => item.id === noteId
        );

        if (!note) {
            return;
        }

        if (
            !window.confirm(
                `Delete the note at ${formatTimestamp(
                    note.timestampSeconds
                )}?`
            )
        ) {
            return;
        }

        notebook.notes = notebook.notes.filter(
            (item) => item.id !== noteId
        );

        notebook.updatedAt = new Date().toISOString();
        saveState();
        renderNotes();

        if (elements.editingNoteId.value === noteId) {
            resetNoteForm();
        }

        showStatus("Note deleted.");
    }

    function clearNotes() {
        const notebook = getActiveNotebook();

        if (notebook.notes.length === 0) {
            showStatus("There are no notes to clear.");
            return;
        }

        if (
            !window.confirm(
                "Delete every note in this notebook? This cannot be undone."
            )
        ) {
            return;
        }

        notebook.notes = [];
        notebook.updatedAt = new Date().toISOString();
        saveState();
        renderNotes();
        resetNoteForm();
        showStatus("All notes cleared.");
    }

    function buildMarkdown(notebook = getActiveNotebook()) {
        const title = notebook.name || DEFAULT_NOTEBOOK_NAME;
        const fighterA = notebook.fighterA.trim() || "Fighter A";
        const fighterB = notebook.fighterB.trim() || "Fighter B";
        const event = notebook.event.trim() || "Not specified";
        const notes = [...notebook.notes].sort(
            (a, b) => a.timestampSeconds - b.timestampSeconds
        );

        const lines = [
            `# ${title}`,
            "",
            `**Fight:** ${fighterA} vs. ${fighterB}`,
            `**Event or source:** ${event}`,
            `**Scheduled rounds:** ${notebook.scheduledRounds}`,
            notebook.videoUrl
                ? `**Video:** ${notebook.videoUrl}`
                : null,
            "",
            "## Tape Notes",
            ""
        ].filter((line) => line !== null);

        if (notes.length === 0) {
            lines.push("_No tape notes recorded._");
            return lines.join("\n");
        }

        notes.forEach((note) => {
            lines.push(
                `### ${formatTimestamp(
                    note.timestampSeconds
                )} — Round ${note.round}`
            );

            lines.push("");
            lines.push(
                `**Subject:** ${getSideLabel(note.side, notebook)}`
            );

            lines.push(`**Category:** ${note.category}`);
            lines.push("");
            lines.push(note.text);
            lines.push("");
        });

        return lines.join("\n").trim() + "\n";
    }

    async function copyMarkdown() {
        const markdown = buildMarkdown();

        try {
            await navigator.clipboard.writeText(markdown);
            showStatus("Markdown copied.");
        } catch (error) {
            const temporary = document.createElement("textarea");
            temporary.value = markdown;
            temporary.setAttribute("readonly", "");
            temporary.style.position = "fixed";
            temporary.style.left = "-9999px";
            document.body.appendChild(temporary);
            temporary.select();

            const copied = document.execCommand("copy");
            temporary.remove();

            showStatus(
                copied
                    ? "Markdown copied."
                    : "Markdown could not be copied."
            );
        }
    }

    function downloadFile(fileName, contents, type) {
        const blob = new Blob([contents], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        window.setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 500);
    }

    function downloadMarkdown() {
        const notebook = getActiveNotebook();

        downloadFile(
            `${safeFileName(notebook.name)}.md`,
            buildMarkdown(notebook),
            "text/markdown;charset=utf-8"
        );

        showStatus("Markdown downloaded.");
    }

    function downloadJson() {
        const notebook = getActiveNotebook();

        downloadFile(
            `${safeFileName(notebook.name)}.json`,
            JSON.stringify(
                {
                    app: "MMA Matlock Fight Tape Notebook",
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    notebook
                },
                null,
                2
            ),
            "application/json;charset=utf-8"
        );

        showStatus("Notebook backup downloaded.");
    }

    async function importJson(file) {
        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const candidate = parsed.notebook || parsed;

            if (
                !candidate ||
                typeof candidate !== "object" ||
                !Array.isArray(candidate.notes)
            ) {
                throw new Error("Invalid notebook file.");
            }

            const imported = normalizeNotebook({
                ...candidate,
                id: createId("notebook"),
                name: `${candidate.name || DEFAULT_NOTEBOOK_NAME} (Imported)`
            });

            state.notebooks.push(imported);
            state.activeId = imported.id;
            saveState();
            renderAll();
            showStatus("Notebook imported.");
        } catch (error) {
            console.error(error);
            showStatus("That file is not a valid notebook backup.");
        } finally {
            elements.importFile.value = "";
        }
    }

    function createNewNotebook() {
        const requestedName = window.prompt(
            "Name this notebook:",
            DEFAULT_NOTEBOOK_NAME
        );

        if (requestedName === null) {
            return;
        }

        const notebook = createNotebook(
            requestedName.trim() || DEFAULT_NOTEBOOK_NAME
        );

        state.notebooks.push(notebook);
        state.activeId = notebook.id;
        saveState();
        renderAll();
        showStatus("New notebook created.");
    }

    function renameNotebook() {
        const notebook = getActiveNotebook();
        const requestedName = window.prompt(
            "Rename this notebook:",
            notebook.name
        );

        if (requestedName === null) {
            return;
        }

        const trimmed = requestedName.trim();

        if (!trimmed) {
            showStatus("Notebook name cannot be empty.");
            return;
        }

        notebook.name = trimmed;
        notebook.updatedAt = new Date().toISOString();
        saveState();
        populateNotebookSelector();
        showStatus("Notebook renamed.");
    }

    function deleteNotebook() {
        const notebook = getActiveNotebook();

        if (
            !window.confirm(
                `Delete "${notebook.name}" and all of its notes?`
            )
        ) {
            return;
        }

        state.notebooks = state.notebooks.filter(
            (item) => item.id !== notebook.id
        );

        if (state.notebooks.length === 0) {
            const replacement = createNotebook();
            state.notebooks.push(replacement);
        }

        state.activeId = state.notebooks[0].id;
        saveState();
        renderAll();
        showStatus("Notebook deleted.");
    }

    function persistFightFields() {
        updateActiveNotebook({
            fighterA: elements.fighterA.value.trim(),
            fighterB: elements.fighterB.value.trim(),
            event: elements.event.value.trim(),
            scheduledRounds: Number(
                elements.scheduledRounds.value
            )
        });

        populateRoundOptions();
        updateSideOptionLabels();
        renderNotes();
    }

    elements.notebookSelector.addEventListener(
        "change",
        () => {
            state.activeId = elements.notebookSelector.value;
            saveState();
            renderAll();
        }
    );

    elements.newNotebook.addEventListener(
        "click",
        createNewNotebook
    );

    elements.renameNotebook.addEventListener(
        "click",
        renameNotebook
    );

    elements.deleteNotebook.addEventListener(
        "click",
        deleteNotebook
    );

    [
        elements.fighterA,
        elements.fighterB,
        elements.event
    ].forEach((field) => {
        field.addEventListener("change", persistFightFields);
        field.addEventListener("blur", persistFightFields);
    });

    elements.scheduledRounds.addEventListener(
        "change",
        persistFightFields
    );

    elements.loadVideo.addEventListener(
        "click",
        () => loadVideoFromUrl(elements.videoUrl.value)
    );

    elements.videoUrl.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                loadVideoFromUrl(elements.videoUrl.value);
            }
        }
    );

    elements.localVideo.addEventListener(
        "change",
        () => loadLocalVideo(elements.localVideo.files[0])
    );

    elements.seekBack.addEventListener(
        "click",
        () => seekVideo(getCurrentVideoTime() - 5)
    );

    elements.seekForward.addEventListener(
        "click",
        () => seekVideo(getCurrentVideoTime() + 5)
    );

    elements.useCurrentTime.addEventListener(
        "click",
        () => {
            elements.noteTime.value = formatTimestamp(
                getCurrentVideoTime()
            );

            elements.noteText.focus();
        }
    );

    elements.noteForm.addEventListener(
        "submit",
        addOrUpdateNote
    );

    elements.noteText.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey)
            ) {
                event.preventDefault();
                elements.noteForm.requestSubmit();
            }
        }
    );

    elements.cancelEdit.addEventListener(
        "click",
        resetNoteForm
    );

    elements.noteList.addEventListener(
        "click",
        (event) => {
            const seekButton = event.target.closest(
                "[data-seek-note]"
            );

            const editButton = event.target.closest(
                "[data-edit-note]"
            );

            const deleteButton = event.target.closest(
                "[data-delete-note]"
            );

            if (seekButton) {
                const notebook = getActiveNotebook();
                const note = notebook.notes.find(
                    (item) =>
                        item.id === seekButton.dataset.seekNote
                );

                if (note) {
                    seekVideo(note.timestampSeconds);
                }
            }

            if (editButton) {
                editNote(editButton.dataset.editNote);
            }

            if (deleteButton) {
                deleteNote(deleteButton.dataset.deleteNote);
            }
        }
    );

    [
        elements.noteSearch,
        elements.filterRound,
        elements.filterSide,
        elements.filterCategory,
        elements.noteSort
    ].forEach((control) => {
        control.addEventListener("input", renderNotes);
        control.addEventListener("change", renderNotes);
    });

    elements.clearNotes.addEventListener(
        "click",
        clearNotes
    );

    elements.copyMarkdown.addEventListener(
        "click",
        copyMarkdown
    );

    elements.downloadMarkdown.addEventListener(
        "click",
        downloadMarkdown
    );

    elements.downloadJson.addEventListener(
        "click",
        downloadJson
    );

    elements.importJson.addEventListener(
        "click",
        () => elements.importFile.click()
    );

    elements.importFile.addEventListener(
        "change",
        () => importJson(elements.importFile.files[0])
    );

    window.addEventListener(
        "beforeunload",
        destroyActiveVideo
    );

    renderAll();
})();
