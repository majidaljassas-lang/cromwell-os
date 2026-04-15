/**
 * Smoke test for bills pipeline helpers. Safe to run against live DB —
 * only reads (AP ledger, VAT position, pnl sweep writes only when lockable).
 */
import { getApLedger } from "../src/lib/bills/ap-ledger";
import { getVatPosition } from "../src/lib/bills/vat-position";
import { sweepPnlLock } from "../src/lib/bills/pnl-lock";
import { runReverseCheck } from "../src/lib/bills/reverse-check";

(async () => {
  const ap = await getApLedger(new Date());
  console.log("AP:", {
    unpaidCount: ap.totals.unpaidCount,
    unpaidAmount: ap.totals.unpaidAmount,
    overdue: ap.overdue.count,
    dueThisWeek: ap.dueThisWeek.count,
    upcoming: ap.upcoming.count,
    noDue: ap.noDueDate.count,
  });

  const vat = await getVatPosition(new Date("2026-01-01"), new Date("2026-04-15"));
  console.log("VAT:", vat);

  const rev = await runReverseCheck({ since: new Date("2026-04-01") });
  console.log("Reverse check:", { scanned: rev.scanned, flagged: rev.flagged, cleared: rev.cleared });

  const sw = await sweepPnlLock();
  console.log("PnL sweep:", { scanned: sw.scanned, locked: sw.locked, skipped: sw.skipped, closed: sw.closedTickets.length });

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
