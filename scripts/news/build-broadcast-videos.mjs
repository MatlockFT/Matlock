import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VIDEO_SOURCES = [
  { name: 'MMA Fighting', handle: 'MMAFightingonSBN' },
  { name: 'MMA Junkie', handle: 'MMAJunkieOfficial' },
  { name: 'UFC', handle: 'ufc' },
  { name: 'ESPN MMA', handle: 'espnmma' },
  { name: 'MMAWeekly', handle: 'mmaweekly' }
];
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
const text = value => String(value?.simpleText || value?.runs?.map(run => run.text || '').join('') || '').trim();

function normalizeLockup(lockup) {
  if (lockup?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const metadata = lockup.metadata?.lockupMetadataViewModel;
  const parts = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(row => row.metadataParts || []) || [];
  const published = parts.find(part => /ago/i.test(part.accessibilityLabel || part.text?.content || ''));
  const badges = lockup.contentImage?.thumbnailViewModel?.overlays?.flatMap(overlay => overlay.thumbnailBottomOverlayViewModel?.badges || []) || [];
  const clock = badges.map(badge => badge.thumbnailBadgeViewModel?.text || '').find(value => clockSeconds(value));
  return { videoId: lockup.contentId, title: { simpleText: metadata?.title?.content }, lengthText: { simpleText: clock },
    publishedTimeText: { simpleText: published?.accessibilityLabel || published?.text?.content },
    navigationEndpoint: lockup.rendererContext?.commandContext?.onTap?.innertubeCommand };
}

export function initialData(html) {
  const marker = /(?:var\s+ytInitialData\s*=|window\["ytInitialData"\]\s*=)\s*/.exec(html);
  if (!marker) throw new Error('Channel video list was unavailable.');
  const start = html.indexOf('{', marker.index + marker[0].length);
  if (start < 0) throw new Error('Channel video list was incomplete.');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  throw new Error('Channel video list was incomplete.');
}

export function clockSeconds(clock) {
  if (!/^\d+(?::[0-5]\d){1,2}$/.test(clock || '')) return 0;
  return clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function approximateDate(label, now) {
  const match = label.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return null;
  const units = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
  return new Date(now - Number(match[1]) * units[match[2].toLowerCase()]).toISOString();
}

export function channelVideos(data, source, now = Date.now()) {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const selected = tabs.find(tab => tab.tabRenderer?.selected)?.tabRenderer;
  if (!selected || !/videos/i.test(selected.title || '')) throw new Error('Expected the channel Videos tab.');
  const result = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    const video = node.videoRenderer || normalizeLockup(node.lockupViewModel);
    if (video) {
      const id = String(video.videoId || ''), title = text(video.title), duration = clockSeconds(text(video.lengthText));
      const url = String(video.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '');
      const publishedText = text(video.publishedTimeText);
      const publishedAt = approximateDate(publishedText, now);
      // Shorts can be up to 3 minutes. Exclude that entire duration range, explicit
      // Shorts, scheduled/live entries, and unknown lengths; never guess a length.
      if (/^[A-Za-z0-9_-]{11}$/.test(id) && title && duration > 180 && /^\/watch\?/.test(url) && !/\/shorts\/|#shorts\b/i.test(url + ' ' + title)
          && !video.upcomingEventData && !video.isLive && (!publishedAt || now - Date.parse(publishedAt) <= MAX_AGE)) {
        result.set(id, { id, title: title.slice(0, 240), url: 'https://www.youtube.com/watch?v=' + id,
          source: source.name, sourceUrl: 'https://www.youtube.com/@' + source.handle + '/videos',
          duration, thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
          publishedText, publishedAt, publishedAtEstimated: Boolean(publishedAt), checkedAt: new Date(now).toISOString() });
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(selected.content);
  return [...result.values()];
}

export async function buildVideos({ previous = null, fetcher = fetch, now = Date.now() } = {}) {
  const results = await Promise.allSettled(VIDEO_SOURCES.map(async source => {
    const url = 'https://www.youtube.com/@' + source.handle + '/videos';
    const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!response.ok) throw new Error('Channel returned HTTP ' + response.status);
    const videos = channelVideos(initialData(await response.text()), source, now);
    if (!videos.length) throw new Error('No recent non-Short videos with a known duration.');
    return videos.slice(0, 20);
  }));
  const sources = [], videos = [];
  results.forEach((result, index) => {
    const source = VIDEO_SOURCES[index];
    if (result.status === 'fulfilled') {
      sources.push({ name: source.name, status: 'ready', count: result.value.length, checkedAt: new Date(now).toISOString() });
      videos.push(...result.value);
    } else {
      const cached = (previous?.videos || []).filter(video => video.source === source.name && video.duration > 180 && /^[A-Za-z0-9_-]{11}$/.test(video.id || '')
        && Date.parse(video.checkedAt) > now - MAX_AGE && !/\/shorts\/|#shorts\b/i.test((video.url || '') + ' ' + (video.title || '')));
      sources.push({ name: source.name, status: cached.length ? 'cached' : 'unavailable', count: cached.length, error: result.reason?.message || 'Refresh failed.' });
      videos.push(...cached.map(video => ({ ...video, cached: true })));
    }
  });
  const unique = [...new Map(videos.map(video => [video.id, video])).values()];
  unique.sort((a, b) => String(b.publishedAt || b.checkedAt || '').localeCompare(String(a.publishedAt || a.checkedAt || '')));
  return { version: 1, generatedAt: new Date(now).toISOString(), minimumDurationSeconds: 181, sources, videos: unique.slice(0, 80) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  const destination = process.argv.includes('--output') ? argument('--output') : 'assets/data/broadcast-news-videos.json';
  let previous = null;
  try {
    if (process.argv.includes('--previous-url')) {
      const r = await fetch(argument('--previous-url'), { signal: AbortSignal.timeout(10000) });
      if (r.ok) previous = await r.json();
    } else previous = JSON.parse(await readFile(destination, 'utf8'));
  } catch {}
  const output = await buildVideos({ previous });
  await mkdir(dirname(resolve(destination)), { recursive: true });
  await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
  for (const source of output.sources) console.log(source.name + ': ' + source.status + ' (' + source.count + ')');
  console.log('Wrote ' + output.videos.length + ' non-Short videos to ' + destination);
  // Keep publishing articles even when YouTube temporarily rejects a channel request.
}
