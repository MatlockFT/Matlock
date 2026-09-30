import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialData, clockSeconds, channelVideos, buildVideos, VIDEO_SOURCES } from './build-broadcast-videos.mjs';
const now = Date.parse('2026-09-30T18:00:00Z');
const tab = videos => ({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, title: 'Videos', content: videos } }] } } });
const legacy = (id, length, overrides = {}) => ({ videoRenderer: { videoId: id, title: { simpleText: 'Fight interview' },
  lengthText: { simpleText: length }, publishedTimeText: { simpleText: '2 hours ago' },
  navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=' + id } } }, ...overrides } });

test('parses modern and legacy public channel cards without Shorts, live, old or unknown durations', () => {
  const modern = { lockupViewModel: { contentId: 'abcdefghijk', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '11:06' } }] } }] } },
    metadata: { lockupMetadataViewModel: { title: { content: 'Modern interview' }, metadata: { contentMetadataViewModel: {
      metadataRows: [{ metadataParts: [{ text: { content: '38 min ago' }, accessibilityLabel: '38 minutes ago' }] }] } } } },
    rendererContext: { commandContext: { onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: '/watch?v=abcdefghijk' } } } } } } } };
  const rows = channelVideos(tab([modern, legacy('12345678901', '3:01'), legacy('12345678902', '3:00'), legacy('12345678903', '0:59'),
    legacy('12345678904', 'LIVE'), legacy('12345678905', '10:00', { isLive: true }),
    legacy('12345678906', '10:00', { upcomingEventData: {} }),
    legacy('12345678907', '10:00', { publishedTimeText: { simpleText: '3 weeks ago' } }),
    legacy('12345678908', '10:00', { title: { simpleText: 'Interview #Shorts' } }),
    legacy('12345678909', '10:00', { navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/shorts/12345678909' } } } })]), VIDEO_SOURCES[0], now);
  assert.deepEqual(rows.map(row => row.id), ['abcdefghijk', '12345678901']);
  assert.equal(rows[0].duration, 666); assert.equal(rows[0].publishedAt, '2026-09-30T17:22:00.000Z');
  assert.equal(clockSeconds('1:12:30'), 4350); assert.equal(clockSeconds('12:80'), 0);
});

test('balanced JSON handles escaped quotes/braces and rejects missing, incomplete, wrong tab data', () => {
  const data = { text: 'Quote " and { brace } \\ end' };
  assert.deepEqual(initialData('<script>var ytInitialData = ' + JSON.stringify(data) + '; evil();</script>'), data);
  assert.throws(() => initialData('no data')); assert.throws(() => initialData('var ytInitialData = {'));
  assert.throws(() => channelVideos({ contents: {} }, VIDEO_SOURCES[0]));
});

test('partial channel failures preserve recent cached clips, exclude stale caches, and deduplicate', async () => {
  const previous = { videos: [
    { id: 'cache123456', title: 'Cached interview', url: 'https://www.youtube.com/watch?v=cache123456', source: VIDEO_SOURCES[1].name, duration: 200, checkedAt: new Date(now - 60000).toISOString() },
    { id: 'old12345678', source: VIDEO_SOURCES[1].name, duration: 200, checkedAt: new Date(now - 20 * 86400000).toISOString() }
  ] };
  const output = await buildVideos({ now, previous, fetcher: async url => {
    if (!url.includes(VIDEO_SOURCES[0].handle)) throw new Error('offline');
    return { ok: true, text: async () => 'var ytInitialData = ' + JSON.stringify(tab([legacy('abcdefghijk', '8:00'), legacy('abcdefghijk', '8:00')])) + ';' };
  } });
  assert.equal(output.videos.length, 2); assert.equal(output.sources[1].status, 'cached');
  assert.equal(output.sources[2].status, 'unavailable'); assert.equal(output.videos.find(row => row.id === 'cache123456').cached, true);
});

