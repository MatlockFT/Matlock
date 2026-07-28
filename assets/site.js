(() => {
    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationList = document.getElementById("navigation-list");
    let lockedScrollPosition = 0;

    function unlockPageScroll() {
        const bodyWasLocked = document.body.style.position === "fixed";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.right = "";
        document.body.style.left = "";
        document.body.style.width = "";

        if (bodyWasLocked) {
            window.scrollTo(0, lockedScrollPosition);
        }
    }

    function setNavigationState(isOpen, returnFocus = false) {
        if (!navigationToggle || !navigationList) return;

        navigationToggle.setAttribute("aria-expanded", String(isOpen));
        navigationToggle.setAttribute(
            "aria-label",
            isOpen ? "Close main navigation" : "Open main navigation"
        );
        navigationList.classList.toggle("navigation-list-open", isOpen);
        document.body.classList.toggle("navigation-is-open", isOpen);

        if (isOpen && window.innerWidth <= 850) {
            lockedScrollPosition = window.scrollY || window.pageYOffset;
            document.body.style.position = "fixed";
            document.body.style.top = `-${lockedScrollPosition}px`;
            document.body.style.right = "0";
            document.body.style.left = "0";
            document.body.style.width = "100%";
            requestAnimationFrame(() => navigationList.querySelector("a")?.focus());
        } else {
            unlockPageScroll();
        }

        if (returnFocus) navigationToggle.focus();
    }

    if (navigationToggle && navigationList) {
        navigationToggle.addEventListener("click", () => {
            setNavigationState(
                navigationToggle.getAttribute("aria-expanded") !== "true"
            );
        });

        navigationList.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => setNavigationState(false));
        });

        document.addEventListener("click", event => {
            if (
                navigationToggle.getAttribute("aria-expanded") === "true" &&
                !navigationToggle.contains(event.target) &&
                !navigationList.contains(event.target)
            ) {
                setNavigationState(false);
            }
        });

        document.addEventListener("keydown", event => {
            if (
                event.key === "Escape" &&
                navigationToggle.getAttribute("aria-expanded") === "true"
            ) {
                setNavigationState(false, true);
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 850) setNavigationState(false);
        });
        window.addEventListener("pagehide", unlockPageScroll);
    }

    const player = document.getElementById("player");
    const selector = document.getElementById("song-selector");
    const volumeSlider = document.getElementById("volume-slider");
    const playButton = document.getElementById("play-button");
    const pauseButton = document.getElementById("pause-button");
    const audioStatus = document.getElementById("audio-status");

    const setAudioStatus = message => {
        if (audioStatus) audioStatus.textContent = message;
    };

    function updateAudioControls() {
        if (!player || !playButton || !pauseButton) return;
        const isPlaying = !player.paused && !player.ended;
        playButton.disabled = isPlaying;
        pauseButton.disabled = !isPlaying;
    }

    async function playAudio() {
        if (!player) return;

        try {
            await player.play();
            setAudioStatus("");
        } catch (error) {
            console.error(error);
            setAudioStatus("Audio could not be played.");
        }
        updateAudioControls();
    }

    if (player && selector && volumeSlider && playButton && pauseButton) {
        player.src = selector.value;
        player.volume = Number(volumeSlider.value);
        updateAudioControls();

        playButton.addEventListener("click", playAudio);
        pauseButton.addEventListener("click", () => player.pause());
        selector.addEventListener("change", () => {
            const wasPlaying = !player.paused && !player.ended;
            player.src = selector.value;
            player.load();
            setAudioStatus(`Selected ${selector.selectedOptions[0].text}.`);
            if (wasPlaying) playAudio();
        });
        volumeSlider.addEventListener("input", () => {
            player.volume = Number(volumeSlider.value);
        });
        player.addEventListener("play", updateAudioControls);
        player.addEventListener("pause", updateAudioControls);
        player.addEventListener("ended", () => {
            setAudioStatus("Track finished.");
            updateAudioControls();
        });
        player.addEventListener("error", () => {
            setAudioStatus("The selected track could not be loaded.");
            updateAudioControls();
        });
    }

    document.querySelectorAll("[data-hide-broken]").forEach(image => {
        const removeBrokenImage = () => {
            const imageShell = image.closest("[data-image-shell]");
            (imageShell || image).remove();
        };

        image.addEventListener("error", removeBrokenImage);
        if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    });
})();
