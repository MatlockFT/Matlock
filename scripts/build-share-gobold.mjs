// Convert the site's bundled GoBold font to portable SVG outlines. The resulting
// module runs in Node and browsers without a font install, fetch, or dependency.
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

const font = fs.readFileSync(new URL('../Gobold Bold.woff', import.meta.url));
if (font.toString('ascii', 0, 4) !== 'wOFF' || font.readUInt32BE(4) !== 0x00010000) {
  throw new Error('Expected a TrueType WOFF font');
}
const tables = {};
for (let i = 0; i < font.readUInt16BE(12); i++) {
  const at = 44 + i * 20;
  const tag = font.toString('ascii', at, at + 4);
  const offset = font.readUInt32BE(at + 4);
  const compressedLength = font.readUInt32BE(at + 8);
  const originalLength = font.readUInt32BE(at + 12);
  const bytes = font.subarray(offset, offset + compressedLength);
  tables[tag] = compressedLength < originalLength ? inflateSync(bytes) : bytes;
  if (tables[tag].length !== originalLength) throw new Error(`Bad ${tag} table`);
}

const units = tables.head.readUInt16BE(18);
const glyphCount = tables.maxp.readUInt16BE(4);
const longLocations = tables.head.readInt16BE(50) === 1;
const metricCount = tables.hhea.readUInt16BE(34);
const locations = Array.from({ length: glyphCount + 1 }, (_, i) => longLocations
  ? tables.loca.readUInt32BE(i * 4) : tables.loca.readUInt16BE(i * 2) * 2);
const advances = Array.from({ length: glyphCount }, (_, i) =>
  tables.hmtx.readUInt16BE(Math.min(i, metricCount - 1) * 4));
const glyphCache = new Map();

function contoursFor(id, depth = 0) {
  if (glyphCache.has(id)) return glyphCache.get(id);
  if (depth > 12) throw new Error('Recursive glyph components');
  const data = tables.glyf.subarray(locations[id], locations[id + 1]);
  if (!data.length) return [];
  const count = data.readInt16BE(0);
  let at = 10;
  let contours = [];
  if (count >= 0) {
    const ends = [];
    for (let i = 0; i < count; i++, at += 2) ends.push(data.readUInt16BE(at));
    const pointCount = count ? ends.at(-1) + 1 : 0;
    const instructionsLength = data.readUInt16BE(at);
    at += 2 + instructionsLength;
    const flags = [];
    while (flags.length < pointCount) {
      const flag = data[at++];
      flags.push(flag);
      if (flag & 8) {
        const repeat = data[at++];
        for (let i = 0; i < repeat; i++) flags.push(flag);
      }
    }
    let x = 0;
    let y = 0;
    const points = flags.map(flag => {
      if (flag & 2) x += data[at++] * (flag & 16 ? 1 : -1);
      else if (!(flag & 16)) { x += data.readInt16BE(at); at += 2; }
      return { x, y: 0, on: !!(flag & 1) };
    });
    flags.forEach((flag, i) => {
      if (flag & 4) y += data[at++] * (flag & 32 ? 1 : -1);
      else if (!(flag & 32)) { y += data.readInt16BE(at); at += 2; }
      points[i].y = y;
    });
    let start = 0;
    contours = ends.map(end => {
      const contour = points.slice(start, end + 1);
      start = end + 1;
      return contour;
    });
  } else {
    let flags;
    do {
      flags = data.readUInt16BE(at);
      const component = data.readUInt16BE(at + 2);
      at += 4;
      let arg1;
      let arg2;
      const signed = !!(flags & 2);
      if (flags & 1) {
        arg1 = signed ? data.readInt16BE(at) : data.readUInt16BE(at);
        arg2 = signed ? data.readInt16BE(at + 2) : data.readUInt16BE(at + 2);
        at += 4;
      } else {
        arg1 = signed ? data.readInt8(at) : data[at];
        arg2 = signed ? data.readInt8(at + 1) : data[at + 1];
        at += 2;
      }
      let a = 1; let b = 0; let c = 0; let d = 1;
      const f2dot14 = () => { const n = data.readInt16BE(at) / 16384; at += 2; return n; };
      if (flags & 8) a = d = f2dot14();
      else if (flags & 64) { a = f2dot14(); d = f2dot14(); }
      else if (flags & 128) { a = f2dot14(); b = f2dot14(); c = f2dot14(); d = f2dot14(); }
      const transformed = contoursFor(component, depth + 1).map(contour => contour.map(p =>
        ({ x: a * p.x + c * p.y, y: b * p.x + d * p.y, on: p.on })));
      let dx = arg1; let dy = arg2;
      if (!(flags & 2)) {
        const parentPoint = contours.flat()[arg1];
        const childPoint = transformed.flat()[arg2];
        if (!parentPoint || !childPoint) throw new Error('Invalid attached component');
        dx = parentPoint.x - childPoint.x;
        dy = parentPoint.y - childPoint.y;
      } else if (flags & 2048) {
        dx = a * arg1 + c * arg2;
        dy = b * arg1 + d * arg2;
      }
      if (flags & 4) { dx = Math.round(dx); dy = Math.round(dy); }
      contours.push(...transformed.map(contour => contour.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }))));
    } while (flags & 32);
  }
  glyphCache.set(id, contours);
  return contours;
}

const number = n => Number(n.toFixed(3));
const xy = p => `${number(p.x)} ${number(p.y)}`;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
function outlinePath(contours) {
  return contours.map(points => {
    if (!points.length) return '';
    let start;
    let sequence;
    if (points[0].on) { start = points[0]; sequence = points.slice(1); }
    else if (points.at(-1).on) { start = points.at(-1); sequence = points.slice(0, -1); }
    else { start = midpoint(points.at(-1), points[0]); sequence = points.slice(); }
    sequence.push(start);
    let path = `M${xy(start)}`;
    for (let i = 0; i < sequence.length; i++) {
      const point = sequence[i];
      if (point.on) path += `L${xy(point)}`;
      else {
        const next = sequence[i + 1];
        if (next.on) { path += `Q${xy(point)} ${xy(next)}`; i++; }
        else path += `Q${xy(point)} ${xy(midpoint(point, next))}`;
      }
    }
    return `${path}Z`;
  }).join('');
}

const cmap = tables.cmap;
let subtable;
for (let i = 0; i < cmap.readUInt16BE(2); i++) {
  const at = 4 + i * 8;
  const offset = cmap.readUInt32BE(at + 4);
  if (cmap.readUInt16BE(offset) === 4 && (cmap.readUInt16BE(at) === 0 || cmap.readUInt16BE(at) === 3)) {
    subtable = cmap.subarray(offset);
  }
}
if (!subtable) throw new Error('No Unicode cmap format 4');
const segmentCount = subtable.readUInt16BE(6) / 2;
const endAt = 14;
const startAt = endAt + segmentCount * 2 + 2;
const deltaAt = startAt + segmentCount * 2;
const rangeAt = deltaAt + segmentCount * 2;
const mapping = {};
for (let i = 0; i < segmentCount; i++) {
  const start = subtable.readUInt16BE(startAt + i * 2);
  const end = subtable.readUInt16BE(endAt + i * 2);
  const delta = subtable.readInt16BE(deltaAt + i * 2);
  const range = subtable.readUInt16BE(rangeAt + i * 2);
  for (let code = start; code <= end && code < 0xffff; code++) {
    let id;
    if (range) {
      id = subtable.readUInt16BE(rangeAt + i * 2 + range + (code - start) * 2);
      if (id) id = (id + delta) & 0xffff;
    } else id = (code + delta) & 0xffff;
    if (id && code >= 32) mapping[String.fromCodePoint(code)] = id;
  }
}
const glyphs = {};
for (const id of new Set(Object.values(mapping))) {
  glyphs[id] = [advances[id], outlinePath(contoursFor(id))];
}
const metrics = {
  unitsPerEm: units,
  ascender: tables.hhea.readInt16BE(4),
  descender: tables.hhea.readInt16BE(6),
  capHeight: tables['OS/2'].readUInt16BE(0) >= 2 ? tables['OS/2'].readInt16BE(88) : units * 0.75,
};
const runtime = `
const escapeAttribute = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
function glyphFor(character) {
  const normalized = character.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  return glyphs[mapping[character] || mapping[normalized] || mapping['?']];
}
/** Exact advance width in pixels. Optional spacing is in pixels. */
export function measureDisplay(text, size, letterSpacing = 0) {
  const characters = Array.from(String(text));
  return characters.reduce((width, char) => width + glyphFor(char)[0] * size / displayFontMetrics.unitsPerEm, 0) + Math.max(0, characters.length - 1) * letterSpacing;
}
/** Exact bundled GoBold paths; y is the text baseline, matching SVG text. */
export function displayTextSvg(text, { x = 0, y = 0, size = 64, fill = '#fff', stroke = 'none', strokeWidth = 0, anchor = 'start', letterSpacing = 0, opacity = 1 } = {}) {
  const scale = size / displayFontMetrics.unitsPerEm;
  const width = measureDisplay(text, size, letterSpacing);
  let cursor = x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
  const attributes = ' fill="' + escapeAttribute(fill) + '" stroke="' + escapeAttribute(stroke) + '" stroke-width="' + strokeWidth + '" stroke-linejoin="round" paint-order="stroke fill" opacity="' + opacity + '"';
  return Array.from(String(text)).map(character => {
    const [advance, path] = glyphFor(character);
    const svg = path ? '<path d="' + path + '" transform="translate(' + cursor + ' ' + y + ') scale(' + scale + ' ' + -scale + ')" vector-effect="non-scaling-stroke"' + attributes + '/>' : '';
    cursor += advance * scale + letterSpacing;
    return svg;
  }).join('');
}
`;
const output = '// Generated from Gobold Bold.woff by scripts/build-share-gobold.mjs. Do not hand-edit glyph data.\n'
  + `export const displayFontMetrics = ${JSON.stringify(metrics)};\n`
  + `const mapping = ${JSON.stringify(mapping)};\n`
  + `const glyphs = ${JSON.stringify(glyphs)};\n`
  + runtime;
const destination = new URL('../assets/share-gobold.mjs', import.meta.url);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) {
    throw new Error('GoBold module is stale; run node scripts/build-share-gobold.mjs');
  }
  console.log(`GoBold outlines verified: ${Object.keys(glyphs).length} glyphs, ${Object.keys(mapping).length} characters.`);
} else {
  fs.writeFileSync(destination, output);
  console.log(`Wrote ${Buffer.byteLength(output)} bytes: ${Object.keys(glyphs).length} GoBold glyphs, ${Object.keys(mapping).length} characters.`);
}
