import sharp from 'sharp';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const src = process.argv[2];
if (!src) throw new Error('Usage: node scripts/generate-logo.js <source.png>');
const outDir = dirname(src);
const sizes = [640, 1280];

async function run() {
  for (const w of sizes) {
    const pngOut = join(outDir, `logo-header-final-${w}.png`);
    const webpOut = join(outDir, `logo-header-final-${w}.webp`);
    const buf = await sharp(src).resize({ width: w }).png({ quality: 90 }).toBuffer();
    writeFileSync(pngOut, buf);
    const webp = await sharp(buf).webp({ quality: 80 }).toBuffer();
    writeFileSync(webpOut, webp);
    console.log('Wrote', pngOut, webpOut);
  }
}
run().catch(err => { console.error(err); process.exit(1); });
