import assert from 'node:assert/strict';
import { reconcileBookings } from './bookings.mjs';
const checkedAt = '2026-09-11T12:00:00Z', now = Date.parse(checkedAt);
const source = 'https://www.ufc.com/event/test';
const noOverrides = { bookings: [] };
const data = { fighters: [{ id: 'alpha', name: 'Alpha' }, { id: 'bravo', name: 'Bravo' }, { id: 'canceled', name: 'Canceled', booking: { source, date: '2026-09-12' } }, { id: 'past', name: 'Past', booking: { source: 'old', date: '2026-09-10' } }], sources: {} };
const roster = { canonicalFighters: [{ canonicalUrl: 'https://www.ufc.com/athlete/alpha', profileAliases: ['https://www.ufc.com/athlete/old-alpha'] }], eventCardMonitor: { checkedAt, events: [{ url: source, title: 'Test event', startAt: '2026-09-12T12:00:00Z', athletes: ['https://www.ufc.com/athlete/old-alpha', 'https://www.ufc.com/athlete/bravo'] }] } };
const schedule = { generated_at: checkedAt, events: [{ promotion_key: 'ufc', official_url: source, title: 'Test event', date: '2026-09-12', sections: [{ bouts: [{ fighters: [{ name: 'Alpha' }, { name: 'Bravo' }] }, { fighters: [{ name: 'Canceled' }] }] }] }] };
reconcileBookings(data, roster, schedule, now, noOverrides);
assert.equal(data.fighters[0].booking.opponent, 'Bravo');
assert.equal(data.fighters[1].booking.opponentId, 'alpha');
assert.equal(data.fighters[2].booking, null, 'Canceled fighter must not be resurrected by stale schedule');
assert.equal(data.fighters[3].booking, null, 'Past bookings expire');
assert.equal(reconcileBookings(data, roster, schedule, now, noOverrides), 0, 'Repeat sync is stable');
const before = JSON.stringify(data);
assert.throws(() => reconcileBookings(data, { ...roster, eventCardMonitor: { ...roster.eventCardMonitor, checkedAt: '2026-09-01' } }, schedule, now, noOverrides));
assert.equal(JSON.stringify(data), before);

const curated = {
  bookings: [{
    fighters: ['alpha', 'bravo'],
    event: 'Replacement main event',
    date: '2026-10-31',
    source: 'https://example.com/replacement-report'
  }]
};
reconcileBookings(data, roster, schedule, now, curated);
assert.equal(data.fighters[0].booking.event, 'Replacement main event', 'Curated announcement must supersede a stale feed booking.');
assert.equal(data.fighters[0].booking.opponentId, 'bravo');
assert.equal(data.fighters[1].booking.opponentId, 'alpha');
assert.equal(data.sources.bookings.curatedOverrides, 1);
assert.throws(() => reconcileBookings(data, roster, schedule, now, { bookings: [{ fighters: ['alpha', 'missing'], event: 'Bad override', date: '2026-10-31', source: 'https://example.com' }] }), /unknown fighter/i);

console.log('Booking checks passed: aliases, opponents, cancellations, expiry, stale feeds, curated replacements, and repeat sync.');
