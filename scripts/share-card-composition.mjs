import fs from 'node:fs';
import { balancedWrap } from './share-title-layout.mjs';
import { measureDisplay, displayTextSvg } from '../assets/share-gobold.mjs';

const PAPER = '#f1eee4';
const MONO = 'DejaVu Sans Mono, Liberation Mono, monospace';
const tape = `data:image/png;base64,${fs.readFileSync(new URL('../assets/textures/otd-gaffer-tape-v1.png', import.meta.url)).toString('base64')}`;
const FORMATS = { post: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 }, social: { width: 1200, height: 1200 } };
const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const svg = (w, h, content) => `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
const mono = (text, x, y, size, anchor = 'start', opacity = 1) => `<text x="${x}" y="${y}" fill="${PAPER}" opacity="${opacity}" text-anchor="${anchor}" font-family="${MONO}" font-size="${size}" font-weight="700">${esc(text)}</text>`;

function tapedLine(text, x, baseline, size, angle = 0) {
  const width = measureDisplay(text, size);
  const cap = size * .968;
  return `<g transform="rotate(${angle} ${x + width / 2} ${baseline - cap / 2})">
    <image href="${tape}" x="${x - 24}" y="${baseline - cap - 23}" width="${width + 52}" height="${cap + 44}" preserveAspectRatio="none"/>
    ${displayTextSvg(text, { x, y: baseline, size, fill: PAPER })}
  </g>`;
}

export function topMatterSvg(entry, formatName) {
  const { width: w, height: h } = FORMATS[formatName];
  const p = Math.round(w * .04);
  const age = Math.max(0, new Date().getUTCFullYear() - Number(String(entry.date).slice(0, 4)));
  const anniversary = age ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO` : 'ON THIS DAY';
  const date = String(entry.date || '').split('-');
  const label = date.length === 3 ? `${date[1]}.${date[2]}.${date[0]}` : '';
  return svg(w, h, `
    <rect width="${w}" height="${w * .060}" fill="#080808"/>
    ${mono(`ON THIS DAY / ${label}`, p, w * .035, Math.round(w * .013))}
    ${displayTextSvg('MMA MATLOCK', { x: w - p, y: w * .04, size: w * .032, fill: PAPER, anchor: 'end' })}
    ${tapedLine(anniversary, p + 6, w * .155, w * .061, -1.3)}
  `);
}

export function collageMarksSvg(entry, formatName) {
  const { width: w, height: h } = FORMATS[formatName];
  const year = String(entry.date || '').slice(0, 4);
  return svg(w, h, `<g opacity=".10">${displayTextSvg(year, { x: w * .50, y: h * .62, size: w * .75, fill: 'none', stroke: PAPER, strokeWidth: 2, anchor: 'middle' })}</g>`);
}

export function titleAndFooterSvg(entry, formatName, seed, unusedTitleY, imageCredit = clean(entry.imageCredit)) {
  const { width: w, height: h } = FORMATS[formatName];
  const pad = Math.round(w * .05);
  const lines = balancedWrap(clean(entry.title).toUpperCase(), formatName === 'social' ? 22 : 21, 3);
  const available = w * .885;
  const sizes = lines.map(line => Math.min(w * (/^.{1,12}[:;]$/.test(line) ? .18 : .145), available / measureDisplay(line, 1)));
  const heights = sizes.map(size => size * .968 + w * .035);
  const lastBaseline = h - w * .09;
  let baseline = lastBaseline - heights.slice(1).reduce((sum, v) => sum + v, 0);
  let content = '';
  lines.forEach((line, i) => {
    if (i) baseline += heights[i];
    content += tapedLine(line, pad + (i % 2 ? w * .012 : 0), baseline, sizes[i], i % 2 ? .55 : -1.1);
  });
  const credit = clean(imageCredit);
  const creditLine = credit ? `IMAGE${credit.includes(' + ') ? 'S' : ''}: ${credit.toUpperCase()}` : 'MMA HISTORY / MMAMATLOCK.COM';
  const creditSize = Math.min(w * .0105, w * .88 / Math.max(1, creditLine.length * .63));
  content += `<rect y="${h - w * .048}" width="${w}" height="${w * .048}" fill="#080808"/>`;
  content += mono(creditLine, pad, h - w * .021, creditSize, 'start', .72);
  return svg(w, h, content);
}

export function noImageSvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const year = String(entry.date || '').slice(0, 4) || 'MMA';
  const age = Math.max(0, new Date().getUTCFullYear() - Number(year));
  const giant = String(age || year);
  const size = Math.min(w * .86, w * .96 / measureDisplay(giant, 1));
  return svg(w, h, `
    <rect width="${w}" height="${h}" fill="#080808"/>
    <g transform="rotate(-5 ${w / 2} ${h * .42})">
      ${displayTextSvg(giant, { x: w * .48, y: h * .63, size, fill: PAPER, anchor: 'middle' })}
    </g>
    ${mono('FIGHT HISTORY / ' + year, w * .06, h * .74, w * .017)}
    ${topMatterSvg(entry, formatName)}
    ${titleAndFooterSvg(entry, formatName, seed, 0, '')}
  `);
}
