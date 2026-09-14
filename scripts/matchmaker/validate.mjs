export function validateData(data) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(data.schemaVersion === 1 && Number.isFinite(Date.parse(data.generatedAt)), 'Invalid schema/date');
  assert(data.fighters.length >= 500, 'Roster below minimum size');
  const ids = new Set(data.fighters.map(f => f.id));
  const fighterById = new Map(data.fighters.map(f => [f.id, f]));
  assert(ids.size === data.fighters.length, 'Duplicate canonical fighter IDs');
  assert(data.events.length >= 2, 'Not enough verified events');
  const historyV2 = Number(data.sources?.meetings?.historyModelVersion || data.coverage?.historyModelVersion || 0) >= 2;

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
        const sourceOk = meeting.source === 'UFCStats' && /^https:\/\/ufcstats\.com\/fight-details\/[a-f0-9]+/i.test(meeting.sourceUrl || '') || meeting.source === 'UFC.com' && /^https:\/\/(?:www\.)?ufc\.com\/event\//i.test(meeting.sourceUrl || '');
        assert(sourceOk, `Untrusted verified meeting source for ${f.id}`);
        assert(typeof meeting.opponentName === 'string' && meeting.opponentName.trim(), `Missing verified opponent name for ${f.id}`);
        assert(meeting.opponentId === null || meeting.opponentId === undefined || ids.has(meeting.opponentId), `Unknown canonical opponent in verified history for ${f.id}`);
        assert(meeting.opponentStatsId === null || meeting.opponentStatsId === undefined || /^[a-f0-9]{16}$/i.test(meeting.opponentStatsId), `Invalid UFCStats opponent ID for ${f.id}`);
        assert(meeting.fightStatsId === null || meeting.fightStatsId === undefined || /^[a-f0-9]{16}$/i.test(meeting.fightStatsId), `Invalid UFCStats fight ID for ${f.id}`);
        const meetingKey = `${meeting.date}|${meeting.opponentId || meeting.opponentStatsId || meeting.opponentName}`;
        assert(!seen.has(meetingKey), `Duplicate verified meeting for ${f.id}: ${meetingKey}`);
        seen.add(meetingKey);
      }
    }
    if (f.meetingCoverage !== undefined && f.meetingCoverage !== null) {
      assert(/^UFCStats/.test(f.meetingCoverage.source || ''), `Invalid meeting coverage source for ${f.id}`);
      assert(/^https:\/\/raw\.githubusercontent\.com\/Greco1899\/scrape_ufc_stats\//i.test(f.meetingCoverage.sourceUrl || '') || /^https:\/\/ufcstats\.com\//i.test(f.meetingCoverage.sourceUrl || ''), `Invalid meeting coverage URL for ${f.id}`);
      assert(Number.isFinite(Date.parse(f.meetingCoverage.checkedAt)), `Invalid meeting coverage timestamp for ${f.id}`);
      assert(typeof f.meetingCoverage.verified === 'boolean', `Invalid meeting coverage flag for ${f.id}`);
      if (f.meetingCoverage.verified) assert(Array.isArray(f.verifiedMeetings), `Verified coverage without structured history for ${f.id}`);
    }

    if (historyV2) {
      assert(f.historyModelVersion === 2, `Fighter missing history model v2 marker: ${f.id}`);
      assert(Array.isArray(f.profileHistory), `Fighter missing preserved profile history: ${f.id}`);
      assert(f.meetingCoverage && typeof f.meetingCoverage.verified === 'boolean', `Fighter missing v2 coverage record: ${f.id}`);
      if (f.meetingCoverage.verified) {
        assert(/^[a-f0-9]{16}$/i.test(f.meetingCoverage.ufcStatsId || ''), `Verified fighter missing stable UFCStats ID: ${f.id}`);
        assert(['stable-ufcstats-id', 'exact-name', 'unique-alias'].includes(f.meetingCoverage.identityMethod), `Invalid identity method for ${f.id}`);
        assert(f.history.length === f.verifiedMeetings.length, `Canonical history length differs from verified ledger for ${f.id}`);
        assert((f.history[0]?.date || null) === (f.lastFight || null), `Canonical last-fight date mismatch for ${f.id}`);
        for (let i = 0; i < f.history.length; i++) {
          const historyEntry = f.history[i], meeting = f.verifiedMeetings[i];
          assert(historyEntry.date === meeting.date && historyEntry.result === meeting.result, `Canonical history diverged from verified ledger for ${f.id}`);
          assert(Array.isArray(historyEntry.opponentIds), `Canonical history missing opponent IDs for ${f.id}`);
          assert(historyEntry.source === meeting.source && historyEntry.sourceUrl === meeting.sourceUrl, `Canonical history lost source provenance for ${f.id}`);
        }
      } else {
        assert(f.history.length === 0, `Unverified fighter must fail closed with empty canonical history: ${f.id}`);
        assert(f.lastFight === null, `Unverified fighter must not expose a canonical last fight: ${f.id}`);
      }
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
      if (historyV2) {
        const [left, right] = b.fighters;
        for (const [self, opponent] of [[left, right], [right, left]]) {
          const fighter = fighterById.get(self.id);
          assert(fighter?.meetingCoverage?.verified === true, `Displayed fighter lacks verified canonical history: ${self.id}`);
          assert(fighter.verifiedMeetings.some(meeting => meeting.opponentId === opponent.id && meeting.date === e.date && meeting.result === self.result), `Official event result missing from canonical history: ${self.id} vs ${opponent.id} on ${e.date}`);
        }
      }
    }
  }

  assert(new Set(data.rankingsCurrent.map(r => r.division)).size >= 11, 'Incomplete division rankings');

  if (data.sources?.meetings) {
    assert(/^https:\/\/raw\.githubusercontent\.com\/Greco1899\/scrape_ufc_stats\//i.test(data.sources.meetings.url || '') || /^https:\/\/ufcstats\.com\//i.test(data.sources.meetings.url || ''), 'Invalid structured meeting source');
    const participantFighters = [...participants].map(id => fighterById.get(id)).filter(Boolean);
    const verified = participantFighters.filter(f => /^UFCStats/.test(f.meetingCoverage?.source || '') && f.meetingCoverage?.verified === true).length;
    const ratio = participantFighters.length ? verified / participantFighters.length : 0;
    assert(verified > 0 && ratio >= 0.75, `Structured prior-opponent coverage too low: ${verified}/${participantFighters.length}`);
  }

  if (historyV2) {
    assert(/^https:\/\/raw\.githubusercontent\.com\/Greco1899\/scrape_ufc_stats\/main\/ufc_fighter_details\.csv$/i.test(data.sources.meetings.fighterDirectoryUrl || ''), 'Missing trusted UFCStats fighter identity directory');
    const activePopulation = Number(data.coverage?.activeHistoryPopulation || 0);
    const activeVerified = Number(data.coverage?.verifiedActiveHistories || 0);
    assert(activePopulation > 0 && activeVerified / activePopulation >= 0.8, `Verified active-history coverage below v2 floor: ${activeVerified}/${activePopulation}`);
    assert(Number(data.coverage?.verifiedParticipantHistories) === participants.size, `V2 participant coverage must be 100%: ${data.coverage?.verifiedParticipantHistories}/${participants.size}`);
    assert(Number(data.coverage?.mirrorFightCount) >= 8000, 'V2 UFCStats mirror fight count is implausibly low');
    assert(Number(data.coverage?.mirrorFighterCount) >= 3000, 'V2 UFCStats fighter identity count is implausibly low');

    const inverseResult = value => value === 'W' ? 'L' : value === 'L' ? 'W' : value;
    for (const fighter of data.fighters.filter(f => f.meetingCoverage?.verified)) {
      for (const meeting of fighter.verifiedMeetings.filter(m => m.opponentId)) {
        const opponent = fighterById.get(meeting.opponentId);
        if (!opponent?.meetingCoverage?.verified) continue;
        const inverse = opponent.verifiedMeetings.find(other => other.opponentId === fighter.id && other.date === meeting.date);
        assert(inverse, `Verified history is not symmetric: ${fighter.id} -> ${opponent.id} on ${meeting.date}`);
        assert(inverse.result === inverseResult(meeting.result), `Verified history result mismatch: ${fighter.id} / ${opponent.id} on ${meeting.date}`);
      }
    }
  }

  return true;
}
