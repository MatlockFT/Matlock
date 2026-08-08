import fs from 'node:fs/promises';

const path = 'assets/site.js';
const original = await fs.readFile(path, 'utf8');

const before = `        const applyPortraitFraming = image => {
            if (!image?.naturalWidth || !image?.naturalHeight) return;
            const ratio = image.naturalWidth / image.naturalHeight;
            const framing = image.dataset.portraitFraming || "standard";
            const unusual = ratio < 0.62 || ratio > 1.35;

            if (framing === "safe" || unusual) {
                image.style.objectFit = "contain";
                image.style.objectPosition = "50% 12%";
                image.style.transform = unusual ? "scale(1.02)" : "scale(1.08)";
                image.style.transformOrigin = "50% 18%";
            }
        };`;

const after = `        const applyPortraitFraming = image => {
            if (!image?.naturalWidth || !image?.naturalHeight) return;

            const ratio = image.naturalWidth / image.naturalHeight;
            const framing = image.dataset.portraitFraming || "standard";
            const source = image.dataset.portraitSource || "";
            const src = image.currentSrc || image.src || "";
            const standardEspn = source === "espn" || /a\\.espncdn\\.com\\/i\\/headshots\\/mma\\/players\\/full\\//i.test(src);

            const restoreStandardCrop = () => {
                image.style.removeProperty("object-fit");
                image.style.removeProperty("object-position");
                image.style.removeProperty("transform");
                image.style.removeProperty("transform-origin");
            };

            // ESPN/UFC-style headshots often live on a wide transparent canvas.
            // Trust the known portrait format instead of treating that canvas ratio as a bad crop.
            if (framing === "standard" && standardEspn) {
                restoreStandardCrop();
                return;
            }

            // Unknown images only switch to safe framing when their canvas is genuinely extreme.
            const extremeRatio = ratio < 0.46 || ratio > 1.75;
            if (framing === "safe" || extremeRatio) {
                image.style.objectFit = "contain";
                image.style.objectPosition = "50% 12%";
                image.style.transform = extremeRatio ? "scale(1.02)" : "scale(1.08)";
                image.style.transformOrigin = "50% 18%";
                return;
            }

            restoreStandardCrop();
        };`;

if (!original.includes(before)) {
    console.log('Portrait framing patch already applied or source changed.');
    process.exit(0);
}

await fs.writeFile(path, original.replace(before, after));
console.log('Updated portrait framing rules.');
