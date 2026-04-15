// Ingestion cutover — all pollers clamp `since` to this floor so we never
// fetch data older than the cutover, and always backfill from here when
// lastSyncAt is null or earlier.
//
// Written as CJS so both TS server code and the standalone node scripts
// under scripts/ can consume a single source of truth.
const CUTOVER_DATE = new Date("2026-04-01T00:00:00.000Z");

module.exports = { CUTOVER_DATE };
