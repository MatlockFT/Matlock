const targets = [
  {
    label: 'Bellator 29 contemporary Fight24 page',
    url: 'https://www.fight24.pl/?p=9253',
    terms: ['bellator', '29', 'poster', 'grabowski', 'konrad']
  },
  {
    label: 'Pancrase Blow 7 official card',
    url: 'https://www.pancrase.co.jp/tour/2006/0916/card.html',
    terms: ['pancrase', 'blow', '0916', 'poster', 'title', 'main']
  },
  {
    label: 'Pancrase Blow 7 official result',
    url: 'https://www.pancrase.co.jp/data/result/2006/0916.html',
    terms: ['pancrase', 'blow', '0916', 'poster', 'title', 'main']
  },
  {
    label: 'Pancrase Blow 7 tour archive card',
    url: 'https://www.pancrase.co.jp/tourarchive/2006/0916/card.html',
    terms: ['pancrase', 'blow', '0916', 'poster', 'title', 'main']
  },
  {
    label: 'Pancrase Blow 7 tour archive index',
    url: 'https://www.pancrase.co.jp/tourarchive/2006/0916/index.html',
    terms: ['pancrase', 'blow', '0916', 'poster', 'title', 'main']
  }
];

const decode = value => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&#x2F;', '/')
  .replaceAll('\\/', '/');

function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    out[match[1].toLowerCase()] = decode(match[3]);
  }
  return out;
}

function absolute(value, base) {
  const cleaned = decode(value).trim();
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('javascript:')) return '';
  try { return new URL(cleaned, base).href; } catch { return ''; }
}

function score(item, terms) {
  const text = `${item.alt || ''} ${item.title || ''} ${item.url || ''}`.toLowerCase();
  let total = 0;
  for (const term of terms) if (text.includes(term.toLowerCase())) total += 2;
  if (/poster|fight.?card|event.?art|main\.(?:jpg|jpeg|png)|title\.(?:jpg|jpeg|png)|bellator.?29|0916/i.test(text)) total += 6;
  if (/logo|icon|avatar|sprite|banner_ad|facebook|twitter|author/i.test(text)) total -= 8;
  return total;
}

async function probe(target) {
  console.log(`\n=== ${target.label} ===`);
  let response;
  try {
    response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MMA-Matlock-Poster-Probe/4.0',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9,ja;q=0.8,pl;q=0.7'
      }
    });
  } catch (error) {
    console.log(`FETCH ERROR: ${error?.name}: ${error?.message}`);
    return;
  }

  console.log(`HTTP ${response.status} -> ${response.url}`);
  if (!response.ok) return;
  const type = response.headers.get('content-type') || '';
  console.log(`content-type=${type}`);
  const html = await response.text();
  console.log(`html-bytes=${Buffer.byteLength(html)}`);

  const candidates = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = a.property || a.name || '';
    if (!/image/i.test(key)) continue;
    const url = absolute(a.content, response.url);
    if (url) candidates.push({ kind: `meta:${key}`, url, alt: a['og:image:alt'] || '', title: '' });
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const alt = a.alt || '';
    const title = a.title || '';
    for (const key of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy']) {
      const url = absolute(a[key], response.url);
      if (url) candidates.push({ kind: `img:${key}`, url, alt, title });
    }
    for (const key of ['srcset', 'data-srcset']) {
      for (const part of String(a[key] || '').split(',')) {
        const url = absolute(part.trim().split(/\s+/)[0], response.url);
        if (url) candidates.push({ kind: `img:${key}`, url, alt, title });
      }
    }
  }

  const unique = [...new Map(candidates.map(item => [item.url, item])).values()]
    .map(item => ({ ...item, score: score(item, target.terms) }))
    .sort((a, b) => b.score - a.score);

  console.log(`images-found=${unique.length}`);
  for (const item of unique.slice(0, 40)) {
    console.log(`[${item.score}] ${item.kind} | alt=${item.alt || '(none)'} | title=${item.title || '(none)'} | ${item.url}`);
  }

  const textual = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const lower = textual.toLowerCase();
  for (const term of target.terms.slice(0, 3)) {
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0) console.log(`TEXT ${term}: ${textual.slice(Math.max(0, index - 180), index + 360)}`);
  }
}

for (const target of targets) await probe(target);
