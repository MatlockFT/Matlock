import { slug } from './sources/ufc.mjs';

export const rosterUrl = 'https://github.com/MatlockFT/Matlock/releases/download/ufc-roster-data/ufc-roster-state.json';
export function reconcileRoster(data, roster, overrides = {}, now = Date.now()) {
  const age = now - Date.parse(roster.checkedAt);
  const entries = roster.canonicalFighters;
  if (!Number.isFinite(age) || age < -300000 || age > 86400000 || !Array.isArray(entries) || entries.filter(f => f.active === true).length < 500) throw new Error('Roster is stale or incomplete; retaining published availability.');
  const index = new Map();
  for (const entry of entries) {
    if (typeof entry.active !== 'boolean' || !slug(entry.canonicalUrl)) throw new Error('Invalid canonical roster entry');
    for (const url of [entry.canonicalUrl, ...(entry.profileAliases || []), ...(entry.activeProfileUrls || [])]) {
      const id = slug(url);
      if (!id || index.has(id) && index.get(id) !== entry) throw new Error('Conflicting roster identity');
      index.set(id, entry);
    }
  }
  for (const [id, override] of Object.entries(overrides)) {
    if (override.active !== false || !override.reason || !/^https:\/\//.test(override.source || '') || !Number.isFinite(Date.parse(override.verifiedAt))) throw new Error(`Invalid roster override: ${id}`);
  }
  const decisions = data.fighters.map(f => {
    const entry = index.get(f.id) || index.get(slug(f.source));
    if (!entry && f.active) throw new Error(`Active fighter missing from canonical registry: ${f.id}`);
    const override = overrides[f.id] || overrides[slug(entry?.canonicalUrl)];
    const inactiveProfile = ['inactive', 'retired', 'not fighting'].includes((f.profileStatus || '').toLowerCase());
    // An explicit inactive profile remains excluded until a later profile says Active.
    const active = !!entry?.active && !inactiveProfile && !override;
    const reason = override ? 'editorial-departure' : inactiveProfile ? 'ufc-profile-inactive' : active ? 'ufc-active-roster' : 'absent-from-ufc-active-roster';
    return { f, active, reason, source: override?.source || (inactiveProfile ? f.source : rosterUrl) };
  });
  const changes = [];
  for (const { f, active, reason, source } of decisions) {
    if (f.active !== active) changes.push({ id: f.id, name: f.name, active, reason });
    f.active = active;
    if (f.rosterEligibility?.reason !== reason || f.rosterEligibility?.source !== source) f.rosterEligibility = { reason, source, checkedAt: roster.checkedAt };
  }
  data.coverage.activeFighters = data.fighters.filter(f => f.active).length;
  return changes;
}
