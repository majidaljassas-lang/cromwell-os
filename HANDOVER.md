# Handover — feature/bill-processing-pipeline

Last updated: 2026-04-15 by Majid + Claude (Opus 4.6 1M)

## Where this branch stands

Branched from `feature/ingestion-cutover @ 3c414c2`.

Implements an end-to-end bill processing pipeline: **thread → AI extract → SupplierBill → match/route → AP ledger → P&L lock**. Everything is additive; nothing was removed. Existing intake engine (IntakeDocument → workers) is left intact — this pipeline runs alongside it for the inbox-thread path.

## What shipped

1. **Schema extensions** (`prisma/schema.prisma`)
   - `SupplierBill`: + `dueDate`, `paymentStatus` (default UNPAID), `amountExVat`, `vatAmount`, `amountIncVat`, `sourceThreadId`, plus indexes on dueDate / paymentStatus / sourceThreadId.
   - `SalesInvoiceLine`: + `vatRate`, `vatAmount`, `costUnconfirmed` (indexed).
   - `MarginLockAudit`: new model — immutable record of every P&L lock event, with supplierBillIds[] and salesInvoiceIds[] for traceability.
   - Pushed to dev DB.

2. **New modules** (`src/lib/bills/`)
   - `ai-extractor.ts` — `extractBillFromText(rawText)`. Anthropic Messages API via existing `callClaude` wrapper. Strict JSON schema: supplierName / invoiceNo / invoiceDate / dueDate / lines[{description, qty, unit, unitCost, vatRate, lineTotal}] / totalExVat / vatAmount / totalIncVat. Regex fallback (existing `parseBillText`) when `ANTHROPIC_API_KEY` is unset, so the pipeline still works in dev.
   - `supplier-resolver.ts` — `resolveSupplier({name, participants})`. Name exact → SupplierAlias → email-domain alias → stub. Stubs get audit-logged with the extracted name + domains so a human merge step has full context.
   - `due-date.ts` — `inferDueDate(invoiceDate, text)`. Parses "net 30", "30 days", "due on receipt"; defaults to +30 days.
   - `pipeline.ts` — `processBillThread(threadId)`. Idempotent orchestrator. Builds thread text, extracts, resolves supplier, creates SupplierBill + lines with VAT populated, records in AP as UNPAID, then runs matching and unmatched routing over every line. Returns counts (matched / exceptions / allUnmatchedRouted). Duplicate runs short-circuit to re-matching only.
   - `reverse-check.ts` — `runReverseCheck({since})`. Scans SalesInvoiceLine since date; flags `costUnconfirmed=true` when no CostAllocation / AbsorbedCostAllocation / BillLineAllocation covers the TicketLine; also writes `TicketLine.costStatus='UNCONFIRMED'`. Clears the flag when coverage appears.
   - `vat-position.ts` — `getVatPosition(from, to)`. Input VAT = Σ SupplierBillLine.vatAmount (scoped by billDate). Output VAT = Σ SalesInvoiceLine.vatAmount (scoped by issuedAt, status ∈ SENT/PAID). Position = output − input.
   - `ap-ledger.ts` — `getApLedger(asOf)`. Unpaid bills bucketed into overdue / dueThisWeek / upcoming / noDueDate, with ageDays per row.
   - `pnl-lock.ts` — `tryLockTicketLine(id)` + `sweepPnlLock()`. Locks a TicketLine only when every invoice line is PAID AND every funding SupplierBill is PAID AND no UNRESOLVED allocations remain. Writes actualCost/Sale/Margin/Variance, sets isLocked, emits MarginLockAudit. When all lines of a ticket lock, the Ticket itself closes.

3. **API routes** (`src/app/api/bills/…`)
   - `POST /api/bills/process` — body `{ threadId }`. Runs the full pipeline, returns `PipelineResult`.
   - `GET  /api/bills/ap-ledger[?asOf=YYYY-MM-DD]` — aged view.
   - `GET  /api/bills/vat-position?from&to` — defaults to current UK VAT quarter.
   - `POST /api/bills/reverse-check` — runs a scan. `GET` lists currently-flagged invoice lines.
   - `POST /api/bills/pnl-lock` — with `ticketLineId` locks one line, without it sweeps all candidates.

4. **Smoke script** — `scripts/test-bills-pipeline.ts`. Calls AP / VAT / reverse-check / PnL sweep against the live DB. Last run (2026-04-15):
   ```
   AP:            unpaidCount=26 unpaidAmount=£9,530.14 (all noDueDate — legacy bills pre-field)
   VAT:           25 input bills, 7 output invoices, £0 input/£0 output  (legacy rows lack per-line VAT)
   Reverse check: 61 scanned, 54 flagged unconfirmed
   PnL sweep:     15 scanned, 0 locked  (correct — no bills in PAID state yet)
   ```

## End-to-end mapping to the 8-step spec

| # | Requirement | Where |
|---|---|---|
| 1 | AI extracts supplier / invoice# / dates / lines / totals | `src/lib/bills/ai-extractor.ts` |
| 2 | SupplierBill with full lines + AP UNPAID + dueDate + thread link | `src/lib/bills/pipeline.ts` |
| 3 | Match lines by site/desc/tokens with scoring; HIGH auto-link, LOW review | `matchBillLine` in `src/lib/intake/match-engine.ts` (reused); called by pipeline |
| 4 | Unmatched lines forced into Invoice Now / To Stock / Return; no float | `allocateBillLine` in `src/lib/intake/allocation-engine.ts` (reused). `allUnmatchedRouted=false` whenever any UNRESOLVED remains |
| 5 | Reverse check — invoice lines with no bill line flagged | `src/lib/bills/reverse-check.ts` |
| 6 | Running VAT position | `src/lib/bills/vat-position.ts` (per-line VAT on SupplierBillLine + SalesInvoiceLine) |
| 7 | AP aged ledger | `src/lib/bills/ap-ledger.ts` |
| 8 | P&L lock on deal close | `src/lib/bills/pnl-lock.ts` + MarginLockAudit |

## How to drive the pipeline

1. Inbox classifier marks a thread `classification='BILL'`.
2. Call `POST /api/bills/process { "threadId": "…" }`.
3. Response tells you:
   - `supplierBillId` — the bill that was created (or reused)
   - `extractedLines` / `matched` / `exceptions`
   - `allUnmatchedRouted` — `false` means a human needs to intervene on an UNRESOLVED allocation.
4. Nightly: `POST /api/bills/reverse-check` + `POST /api/bills/pnl-lock` (no body = sweep).

## Known gaps / follow-ups

- **Auto-trigger on classification.** The inbox auto-classifier doesn't yet call `/api/bills/process` on transition to BILL — wire this into the classifier flow (`src/lib/ingestion/classifier.ts`) or add a queue drain.
- **Bill attachments.** Pipeline reads thread message snippets. PDF attachments still go through the existing IntakeDocument path (`runPdfParser` → `runBillExtractor`). Unify once we trust the AI extractor on PDF text.
- **VAT population on existing data.** Legacy SupplierBillLine / SalesInvoiceLine rows lack `vatAmount`. New data through the pipeline populates it; a one-off backfill would surface the full position for pre-2026-04-15 history if needed.
- **Payment status transitions.** `SupplierBill.paymentStatus` flips UNPAID → PARTIALLY_PAID → PAID when `PaymentMadeAllocation` rows are written. That write path exists in `src/lib/finance/*` but is not yet driven by bank sync — manual for now.
- **UI.** No dedicated bill-processing pages yet; existing `/procurement` and `/accounts-payable` views continue to serve, and now benefit from the new `dueDate` / VAT fields as data flows in.

## Prior branch context — `feature/ingestion-cutover`

Kept here for continuity; see `git log feature/ingestion-cutover` for full details:

- CUTOVER_DATE floor (2026-04-01) enforced across Outlook / WhatsApp / backfill pollers.
- WhatsApp backfill via direct `Store.Msg.getModelsArray()` (whatsapp-web.js 1.34.6 `fetchMessages` is broken against current WhatsApp Web).
- Content-aware auto-linker (`resolveLink` + `scoreAgainstTicket`) wired into both live ingest paths. HIGH ≥70 auto-threads; MEDIUM 40–69 suggests; LOW <40 leaves unlinked. Never creates tickets.
- Known: `cromwell-db` PM2 app loops on an orphan pglite; Prisma `findMany + include` P1017s under sustained load.

## Relevant commits

(this branch; see `git log feature/bill-processing-pipeline`)
