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
  }
  for (const e of data.events) {
    assert(e.completed && e.date <= data.generatedAt.slice(0, 10) && e.bouts.length >= 5, `Invalid completed event ${e.id}`);
    const participants = e.bouts.flatMap(b => b.fighters);
    assert(new Set(participants.map(f => f.id)).size === participants.length, 'Duplicate participant');
    for (const b of e.bouts) {
      assert(b.fighters.length === 2 && b.fighters.every(f => ids.has(f.id) && ['W', 'L', 'D', 'NC'].includes(f.result)), 'Invalid bout');
      const results = b.fighters.map(f => f.result).sort().join(',');
      assert(['L,W', 'D,D', 'NC,NC'].includes(results), 'Inconsistent bout outcomes');
    }
  }
  assert(new Set(data.rankingsCurrent.map(r => r.division)).size >= 11, 'Incomplete division rankings');
  return true;
}
