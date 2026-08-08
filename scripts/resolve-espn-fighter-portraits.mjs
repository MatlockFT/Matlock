import fs from 'node:fs/promises';

const HTML_PATH = 'upcoming-events.html';
const CACHE_PATH = '_data/fighter_portraits.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/1.0; +https://matlockfighttalk.com/)';
const TIMEOUT = 20000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'");
const stripTags = (s='') => decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const norm = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();

async function get(url, asJson=false) {
    let last;
    for (let attempt=0; attempt<2; attempt++) {
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(TIMEOUT),
                headers: {
                    'user-agent': UA,
                    accept: asJson ? 'application/json,*/*' : 'text/html,*/*'
                }
            });
            if (response.ok) return asJson ? response.json() : response.text();
            last = new Error(`${response.status} ${url}`);
        } catch (error) { last = error; }
        await sleep(400);
    }
    throw last;
}

async function imageWorks(url) {
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT),
            headers: {'user-agent': UA, accept: 'image/*,*/*;q=0.8'}
        });
        return response.ok && ((response.headers.get('content-type') || '').startsWith('image/') || /\.(png|jpe?g|webp)(?:\?|$)/i.test(response.url));
    } catch { return false; }
}

function collectMatchingIds(node, wanted, found=new Set()) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
        for (const value of node) collectMatchingIds(value, wanted, found);
        return found;
    }
    const name = norm(node.displayName || node.fullName || node.name || node.shortName || node.title || '');
    const id = String(node.id || node.uid || '').match(/\d{4,}/)?.[0];
    if (id && name && (name === wanted || name.includes(wanted) || wanted.includes(name))) found.add(id);
    for (const value of Object.values(node)) collectMatchingIds(value, wanted, found);
    return found;
}

async function espnIdByName(name) {
    const wanted = norm(name);
    const query = encodeURIComponent(name);

    try {
        const json = await get(`https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=${query}&limit=20`, true);
        const ids = [...collectMatchingIds(json, wanted)];
        for (const id of ids) {
            const portrait = `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;
            if (await imageWorks(portrait)) return id;
        }
    } catch {}

    try {
        const html = await get(`https://www.espn.com/search/_/q/${query}`);
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_ ]+');
        const patterns = [
            new RegExp(`/mma/fighter/(?:_/)?/id/(\\d+)/[^"'<>]*${escaped}`, 'i'),
            /\/mma\/fighter\/_\/id\/(\d+)\//gi
        ];
        for (const pattern of patterns) {
            const matches = [...html.matchAll(pattern)];
            for (const match of matches) {
                const id = match[1];
                const portrait = `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;
                if (await imageWorks(portrait)) return id;
            }
        }
    } catch {}

    return '';
}

const html = await fs.readFile(HTML_PATH, 'utf8');
let cache = {};
try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')); } catch {}

const names = new Set();
for (const match of html.matchAll(/<p class=["']fighter-name["']>([\s\S]*?)<\/p>/gi)) {
    const name = stripTags(match[1]);
    if (name && !/[{}%]/.test(name)) names.add(name);
}

let added = 0;
for (const name of names) {
    const key = norm(name);
    if (!key || cache[key]?.url) continue;
    const id = await espnIdByName(name);
    if (!id) continue;
    cache[key] = {
        url: `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`,
        source: 'espn',
        framing: 'standard'
    };
    added++;
    console.log(`Resolved ESPN portrait: ${name} -> ${id}`);
}

if (added) {
    await fs.writeFile(
        CACHE_PATH,
        JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))), null, 2) + '\n'
    );
}
console.log(`ESPN name lookup added ${added} portrait(s).`);
