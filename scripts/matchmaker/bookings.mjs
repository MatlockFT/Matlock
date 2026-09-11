import { key, slug } from './sources/ufc.mjs';

export function reconcileBookings(data, roster, schedule, now = Date.now()) {
  const monitor = roster.eventCardMonitor;
  const fresh = value => Number.isFinite(Date.parse(value)) && now - Date.parse(value) <= 86400000 && Date.parse(value) <= now + 300000;
  if (!fresh(monitor?.checkedAt) || !Array.isArray(monitor.events) || !monitor.events.length) throw new Error('Booking monitor is stale or incomplete; retaining published bookings.');
  const today = new Date(now).toISOString().slice(0, 10);
  const ids = new Map(data.fighters.map(f => [f.id, f.id]));
  for (const f of roster.canonicalFighters) for (const url of [f.canonicalUrl, ...(f.profileAliases || []), ...(f.activeProfileUrls || [])]) ids.set(slug(url), slug(f.canonicalUrl));
  const names = new Map();
  for (const f of data.fighters) { const name = key(f.name); names.set(name, names.has(name) ? null : f.id); }
  const refreshed = new Set(), bookings = new Map();
  const put = (id, booking) => { if (id && (!bookings.has(id) || booking.date < bookings.get(id).date)) bookings.set(id, booking); };
  for (const event of monitor.events) {
    const date = event.startAt?.slice(0, 10);
    if (!date || !event.url || !Array.isArray(event.athletes) || !event.athletes.length) throw new Error('Incomplete monitored event');
    refreshed.add(event.url);
    if (date < today) continue;
    for (const url of event.athletes) put(ids.get(slug(url)), { event: event.title, date, source: event.url });
  }
  // Schedule bouts provide actual pairings; the monitor only supplies an athlete list.
  if (fresh(schedule?.generated_at)) for (const event of schedule.events || []) {
    if (event.promotion_key !== 'ufc' || event.date < today) continue;
    for (const bout of (event.sections || []).flatMap(s => s.bouts || [])) {
      const fighters = (bout.fighters || []).map(f => ({ id: names.get(key(f.name)), name: f.name }));
      for (const f of fighters) {
        const existing = bookings.get(f.id);
        // A fresher monitored card can remove a canceled participant.
        if (refreshed.has(event.official_url) && (!existing || existing.source !== event.official_url)) continue;
        const opponent = fighters.find(other => other !== f);
        const booking = { event: event.title, date: event.date, source: event.official_url, ...(opponent ? { opponent: opponent.name, opponentId: opponent.id || null } : {}) };
        if (existing?.source === event.official_url) bookings.set(f.id, booking); else put(f.id, booking);
      }
    }
  }
  let changed = 0;
  for (const f of data.fighters) {
    const old = f.booking;
    const booking = bookings.get(f.id) || (old?.date >= today && !refreshed.has(old.source) ? old : null);
    if (JSON.stringify(old) !== JSON.stringify(booking)) changed++;
    f.booking = booking;
  }
  data.sources.bookings = { url: monitor.source || 'https://www.ufc.com/events', checkedAt: monitor.checkedAt };
  return changed;
}
