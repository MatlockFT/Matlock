import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = 'assets/data/matchmaker/current.json';
const STATE_DIR = 'assets/data/matchmaker/state';
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const capturedAt = String(data.generatedAt || '');
const day = capturedAt.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(capturedAt))) {
  throw new Error('Temporal state snapshot requires a valid Matchmaker generatedAt timestamp.');
}
if (!Array.isArray(data.fighters) || !data.fighters.length) throw new Error('Temporal state snapshot requires Matchmaker fighters.');

function compactBooking(booking) {
  if (!booking?.date || !booking?.event) return null;
  return {
    event: booking.event,
    date: booking.date,
    source: booking.source || null,
    ...(booking.opponent ? { opponent: booking.opponent } : {}),
    ...(booking.opponentId ? { opponentId: booking.opponentId } : {})
  };
}

const payload = {
  schemaVersion: 1,
  capturedAt,
  fighters: data.fighters
    .filter(fighter => fighter?.id)
    .map(fighter => ({
      id: fighter.id,
      active: Boolean(fighter.active),
      booking: compactBooking(fighter.booking),
      rosterReason: fighter.rosterEligibility?.reason || null
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
};

await fs.mkdir(STATE_DIR, { recursive: true });
const output = path.join(STATE_DIR, `${day}.json`);
try {
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
  console.log(`Captured immutable Matchmaker temporal state for ${day}: ${payload.fighters.length} fighters.`);
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
  const existing = JSON.parse(await fs.readFile(output, 'utf8'));
  if (!Array.isArray(existing?.fighters) || !Number.isFinite(Date.parse(existing?.capturedAt))) {
    throw new Error(`Existing temporal state snapshot is invalid: ${output}`);
  }
  console.log(`Temporal state snapshot already exists for ${day}; preserving the first capture.`);
}
