import { key, slug } from './sources/ufc.mjs';

// UFC can publish two athlete URLs for the same fighter. Merge only verified
// pairs; an identical display name alone must never be enough to merge people.
const VERIFIED_PROFILE_ALIASES = new Map([
  ['keiichiro-nakamura-0', 'keiichiro-nakamura']
]);

export function buildCanonicalProfileRegistry(entries) {
  const merged = new Map();
  for (const fighter of entries) {
    const originalId = slug(fighter.canonicalUrl);
    if (!originalId) throw new Error('Roster fighter has no canonical UFC athlete URL');
    const id = VERIFIED_PROFILE_ALIASES.get(originalId) || originalId;
    const aliases = [originalId, ...(fighter.profileAliases || []).map(slug), ...(fighter.activeProfileUrls || []).map(slug)].filter(Boolean);
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, {
        id,
        name: fighter.name,
        active: fighter.active === true,
        source: fighter.canonicalUrl,
        aliases: [...new Set(aliases.filter(alias => alias !== id))]
      });
      continue;
    }
    if (key(existing.name) !== key(fighter.name)) throw new Error(`Conflicting UFC profile identity for ${id}`);
    existing.active ||= fighter.active === true;
    existing.aliases = [...new Set([...existing.aliases, ...aliases].filter(alias => alias !== id))];
    // The secondary official URL contains the newer completed UFC event result.
    if (originalId !== id) existing.source = fighter.canonicalUrl;
  }
  const owner = new Map();
  for (const fighter of merged.values()) for (const alias of [fighter.id, ...fighter.aliases]) {
    if (owner.has(alias) && owner.get(alias) !== fighter.id) throw new Error(`Conflicting UFC roster alias: ${alias}`);
    owner.set(alias, fighter.id);
  }
  return [...merged.values()];
}
