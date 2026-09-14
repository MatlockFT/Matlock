export function validateData(data) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(data.schemaVersion === 1 && Number.isFinite(Date.parse(data.generatedAt)), 'Invalid schema/date');
  assert(data.fighters.length >= 500, 'Roster below minimum size');
  const ids = new Set(data.fighters.map(f => f.id));
  assert(ids.size === data.fighters.length, 'Duplicate canonical fighter IDs');
  assert(data.events.length >= 2, 'Not enough verified events');

  for (const f of data.fighters) {
    assert(/^[a-z0-9-]+$/.test(f.id) && f.name && typeof f.active === 'boolean', 'Invalid fighter identity');
    assert(f.rank === null || Number.isInteger(f.rank) && f.rank >= 0 && f.rank <= 15, 'Invalid rank');
    assert(Array.isArray(f.history), 'Missing history');
    if (f.verifiedMeetings !== undefined) {
      assert(Array.isArray(f.verifiedMeetings), `Invalid verified meeting list for ${f.id}`);
      const seen = new Set();
      for (const meeting of f.verifiedMeetings) {
        assert(Number.isFinite(Date.parse(meeting.date)) && meeting.date <= data.generatedAt.slice(0, 10), `Invalid verified meeting date for ${f.id}`);
        assert(['W', 'L', 'D', 'NC'].includes(meeting.result), `Invalid verified meeting result for ${f.id}`);
        assert(meeting.source === 'UFCStats' && /^https:\/\/ufcstats\.com\//i.test(meeting.sourceUrl || ''), `Untrusted verified meeting source for ${f.id}`);
        assert(typeof meeting.opponentName === 'string' && meeting.opponentName.trim(), `Missing verified opponent name for ${f.id}`);
        assert(meeting.opponentId === null || meeting.opponentId === undefined || ids.has(meeting.opponentId), `Unknown canonical opponent in verified history for ${f.id}`);
        const meetingKey = `${meeting.date}|${meeting.opponentStatsId || meeting.opponentId || meeting.opponentName}`;
        assert(!seen.has(meetingKey), `Duplicate verified meeting for ${f.id}: ${meetingKey}`);
        seen.add(meetingKey);
      }
    }
    if (f.meetingCoverage !== undefined && f.meetingCoverage !== null) {
      assert(f.meetingCoverage.source === 'UFCStats', `Invalid meeting coverage source for ${f.id}`);
      assert(/^https:\/\/ufcstats\.com\/fighter-details\//i.test(f.meetingCoverage.sourceUrl || ''), `Invalid meeting coverage URL for ${f.id}`);
      assert(Number.isFinite(Date.parse(f.meetingCoverage.checkedAt)), `Invalid meeting coverage timestamp for ${f.id}`);
      assert(typeof f.meetingCoverage.verified === 'boolean', `Invalid meeting coverage flag for ${f.id}`);
      if (f.meetingCoverage.verified) assert(Array.isArray(f.verifiedMeetings), `Verified coverage without structured history for ${f.id}`);
    }
  }

  const participants = new Set();
  for (const e of data.events) {
    assert(e.completed && e.date <= data.generatedAt.slice(0, 10) && e.bouts.length >= 5, `Invalid completed event ${e.id}`);
    const entries = e.bouts.flatMap(b => b.fighters);
    assert(new Set(entries.map(f => f.id)).size === entries.length, 'Duplicate participant');
    for (const entry of entries) participants.add(entry.id);
    for (const b of e.bouts) {
      assert(b.fighters.length === 2 && b.fighters.every(f => ids.has(f.id) && ['W', 'L', 'D', 'NC'].includes(f.result)), 'Invalid bout');
      const results = b.fighters.map(f => f.result).sort().join(',');
      assert(['L,W', 'D,D', 'NC,NC'].includes(results), 'Inconsistent bout outcomes');
    }
  }

  assert(new Set(data.rankingsCurrent.map(r => r.division)).size >= 11, 'Incomplete division rankings');

  // Once the structured meeting source has been introduced, fail closed on broad source/parser breakage.
  // Individual uncovered fighters can still be withheld by the recommendation layer, but a bad UFCStats
  // scrape must never silently republish as if "no prior meeting" were verified.
  if (data.sources?.meetings) {
    assert(/^https:\/\/ufcstats\.com\//i.test(data.sources.meetings.url || ''), 'Invalid structured meeting source');
    const participantFighters = [...participants].map(id => data.fighters.find(f => f.id === id)).filter(Boolean);
    const verified = participantFighters.filter(f => f.meetingCoverage?.source === 'UFCStats' && f.meetingCoverage?.verified === true).length;
    const ratio = participantFighters.length ? verified / participantFighters.length : 0;
    assert(verified > 0 && ratio >= 0.75, `Structured prior-opponent coverage too low: ${verified}/${participantFighters.length}`);
  }

  return true;
}
