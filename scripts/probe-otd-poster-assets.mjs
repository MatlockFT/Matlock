const targets = [
  {
    label: '2023 Grasso vs Shevchenko 2 UFC Brazil',
    url: 'https://www.ufc.com.br/news/card-completo-noche-ufc-grasso-shevchenko-2',
    terms: ['poster', 'pôster', 'grasso', 'shevchenko', 'noche']
  },
  {
    label: '2023 Grasso vs Shevchenko 2 Wikipedia',
    url: 'https://en.wikipedia.org/wiki/UFC_Fight_Night:_Grasso_vs._Shevchenko_2',
    terms: ['poster', 'grasso', 'shevchenko', 'noche', 'fight night']
  },
  {
    label: '2025 Lopes vs Silva UFC',
    url: 'https://www.ufc.com/news/highly-anticipated-featherweight-clash-between-3-diego-lopes-and-10-jean-silva-headlines-noche',
    terms: ['poster', 'artwork', 'lopes', 'silva', 'noche']
  },
  {
    label: '2025 Lopes vs Silva UFC Brazil',
    url: 'https://www.ufc.com.br/news/card-completo-noche-ufc-lopes-silva',
    terms: ['poster', 'pôster', 'lopes', 'silva', 'noche']
  },
  {
    label: '2025 Lopes vs Silva Wikipedia',
    url: 'https://en.wikipedia.org/wiki/UFC_Fight_Night:_Lopes_vs._Silva',
    terms: ['poster', 'lopes', 'silva', 'noche', 'fight night']
  }
];

const decode = value => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&#x2F;', '/')
  .replaceAll('\\/', '/');

const absolute = (value, base) => {
  const cleaned = decode(value).trim();
  if (!cleaned || cleaned.startsWith('data:')) return '';
  try { return new URL(cleaned, base).href; } catch { return ''; }
};

function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    out[match[1].toLowerCase()] = decode(match[3]);
  }
  return out;
}

function scoreCandidate(candidate, terms) {
  const haystack = `${candidate.alt} ${candidate.url}`.toLowerCase();
  let score = 0;
  for (const term of terms) if (haystack.includes(term.toLowerCase())) score += 2;
  if (/poster|pôster|artwork|event[_-]?art|fight[_-]?card/i.test(haystack)) score += 5;
  if (/logo|flag|icon|avatar|scorecard/i.test(haystack)) score -= 8;
  return score;
}

async function probe(target) {
  console.log(`\n=== ${target.label} ===`);
  let response;
  try {
    response = await fetch(target.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MMA-Matlock-Poster-Probe/1.0',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.7'
      }
    });
  } catch (error) {
    console.log(`FETCH ERROR: ${error?.name}: ${error?.message}`);
    return;
  }
  console.log(`HTTP ${response.status} -> ${response.url}`);
  if (!response.ok) return;

  const html = await response.text();
  const candidates = [];

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = a.property || a.name || '';
    if (!/^(?:og:image|twitter:image)(?::url)?$/i.test(key)) continue;
    const url = absolute(a.content, response.url);
    if (url) candidates.push({ kind: key, url, alt: a['og:image:alt'] || '' });
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const alt = a.alt || a.title || '';
    for (const key of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
      const url = absolute(a[key], response.url);
      if (url) candidates.push({ kind: `img:${key}`, url, alt });
    }
    for (const key of ['srcset', 'data-srcset']) {
      for (const part of String(a[key] || '').split(',')) {
        const url = absolute(part.trim().split(/\s+/)[0], response.url);
        if (url) candidates.push({ kind: `img:${key}`, url, alt });
      }
    }
  }

  for (const match of html.matchAll(/href\s*=\s*(["'])([^"']*(?:Special:Redirect\/file|Special:FilePath|\/wiki\/File:)[^"']*)\1/gi)) {
    const url = absolute(match[2], response.url);
    if (url) candidates.push({ kind: 'file-link', url, alt: '' });
  }

  const unique = [...new Map(candidates.map(item => [item.url, item])).values()]
    .map(item => ({ ...item, score: scoreCandidate(item, target.terms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  for (const item of unique) {
    console.log(`[${item.score}] ${item.kind} | ${item.alt || '(no alt)'} | ${item.url}`);
  }
  if (!unique.length) console.log('No scored image candidates.');
}

for (const target of targets) await probe(target);
