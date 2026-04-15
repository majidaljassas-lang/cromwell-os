# Bills Intake Engine — Gap Report

**Date:** 2026-04-14
**Spec:** `~/.claude/projects/-Users-majidaljassas/memory/bills_intake_engine_spec.md`
**Scope:** Source-agnostic continuous bills intake with line-level multi-allocation (MOQ / grouped / stock / returns), confidence-scored, with learning loop.

---

## 1. Executive summary

Pipeline skeleton exists end-to-end for Zoho pull only. The ingest path is:

```
Zoho pull → IngestionEvent → ParsedMessage → commercialiseZohoBill()
          → SupplierBill + SupplierBillLine
          → autoLinkBillLine()  (single-score SKU+token+UOM match)
          → autoAllocate()      (writes CostAllocation)
```

What is missing to satisfy the spec:

1. **No source-agnostic intake wrapper**. Email PDFs / manual uploads / OCR have no queue, no status machine, no retry/dead-letter — only the Zoho pull path is wired.
2. **No multi-allocation model**. One bill line currently propagates to one ticket/site/customer via columns on `SupplierBillLine`. Splits, grouped purchases, stock/returns/overhead routing of surplus are not represented as first-class records.
3. **No multi-signal scoring**. `autoLinkBillLine` produces one blended score (SKU + tokens + qty). The spec requires five dimensions (supplier, product, ticket, site, entity) with per-signal reasons and configurable weights.
4. **No learning substrate**. No supplier alias table, no supplier product mapping table, no corrections log feeding back into matching.
5. **No duplicate detection** for bills (checksum + header match).
6. **Per-line match audit trail is implicit** (audit log entries only). The spec wants every candidate considered recorded for later training/review.

The existing engines are the right *shape* and will be preserved. New work adds a Document Queue upstream (intake workers) and an Allocation + Match engine downstream of the existing auto-linker.

---

## 2. Architecture — current vs target

### Current

```
[Zoho API] ─► /api/zoho/poll-bills ─► parseZohoBill ─► IngestionEvent
                                                         │
                                                         ▼
                                             commercialiseZohoBill()
                                                         │
                                      ┌──────────────────┼──────────────────┐
                                      ▼                  ▼                  ▼
                              SupplierBill       SupplierBillLine    IngestionLink
                                                         │
                                                         ▼
                                                autoLinkBillLine()  (single blended score)
                                                         │
                                                         ▼
                                                   CostAllocation    (1-to-1 ticket line)
```

Other inputs (email PDF, manual PDF upload, OCR) exist as separate endpoints (`/api/supplier-bills/parse-pdf`, `/api/supplier-bills/import`, ...) but do not converge — each has its own tiny pipeline.

### Target

```
                    ┌────────────────────────────────────────────────────┐
                    │                    INTAKE QUEUE                    │
                    │  (DocumentQueueStatus state machine, retries,      │
                    │   dead-letter, idempotent on checksum)             │
                    └────────────────────────────────────────────────────┘
                                                   ▲
                    ┌──────────────────────────┬───┴───────┬──────────────┐
                    │                          │           │              │
            [Outlook poller]          [Zoho poller]   [PDF upload]   [Manual entry]
                    │                          │           │              │
                    ▼                          ▼           ▼              ▼
                          IntakeDocument (sourceType, rawText, fileRef)
                                                   │
                                                   ▼
                     ┌──────── bill-extractor ─────┴────── pdf-parser / ocr-runner ─┐
                     ▼                                                              ▼
              header + lines parsed                                         fileRef stored
                     │
                     ▼
              duplicate-detector ──► flag DEFINITE / POSSIBLE duplicates
                     │
                     ▼
              SupplierBill + SupplierBillLine (existing models, extended)
                     │
                     ▼
              match-engine (multi-signal)
                supplier  ─┐
                product   ─┼─► BillLineMatch rows (every candidate scored + reasons)
                ticket    ─┤
                site      ─┤
                entity    ─┘
                overall → { AUTO / SUGGESTED / EXCEPTION }
                     │
                     ▼
              allocation-engine
                grouped purchase detector
                MOQ overbuy split
                stock / returns / overhead / unresolved classifier
                pack / length constraints
                     │
                     ▼
              BillLineAllocation rows (N per bill line, sums to bill qty)
                     │
                     ▼
              post-runner ──► CostAllocation / Return / StockExcessRecord / AbsorbedCostAllocation
                     │
                     ▼
              BillIntakeCorrection (when user overrides) ──► feeds SupplierProductMapping, SupplierAlias, SiteAlias
```

---

## 3. Per-model assessment

| Model | Status | Action |
|---|---|---|
| `IngestionEvent` | ✅ exists | Keep. Becomes the canonical source wrapper. |
| `ParsedMessage` | ✅ exists | Keep. `IntakeDocument` sits alongside for non-structured sources. |
| `SupplierBill` | 🔄 needs `intakeDocumentId`, `duplicateOfBillId`, `duplicateStatus`, `checksum` | Extend. |
| `SupplierBillLine` | 🔄 needs `parseConfidence`, `originalUom`, `packSize`, `extractedSku`, `intakeDocumentId` | Extend. |
| `CostAllocation` | ✅ exists | Keep. Becomes a downstream posting target after `BillLineAllocation`. |
| `StockExcessRecord` | ✅ exists | Keep. Written during allocation for STOCK routing. |
| `Return` / `ReturnLine` | ✅ exists | Keep. Written during allocation for RETURNS_CANDIDATE routing. |
| `AbsorbedCostAllocation` | ✅ exists | Keep. Written for OVERHEAD routing. |
| `IngestionAuditLog` | ✅ exists | Reuse instead of adding `IntakeAuditLog`. Already has `objectType/objectId/actionType/actor/previousValueJson/newValueJson/reason/createdAt`. |
| `SiteAlias` | ✅ exists | Already has `aliasText`, `sourceType`, `confidenceDefault`, `manualConfirmed`. Needs `observationCount` + `lastSeenAt`. |
| `CustomerAlias` | ✅ exists | Present; not required by spec but available if needed for entity resolution. |
| `ManualLinkAudit` | ✅ exists | Keep; superseded by `BillIntakeCorrection` for bill-specific overrides but complementary. |
| `BillLineAllocation` | ❌ missing | **Add.** The critical new model. 1 bill line → N destinations. |
| `IntakeDocument` | ❌ missing | **Add.** Upstream wrapper for any source format. |
| `BillLineMatch` | ❌ missing | **Add.** Per-candidate match log with per-signal confidence + reasons + action. |
| `SupplierAlias` | ❌ missing | **Add.** Villeroy-Boch = Ideal Standard, F W Hipkin = VERDIS, etc. |
| `SupplierProductMapping` | ❌ missing | **Add.** supplier SKU → canonical product + historical unit cost. |
| `BillIntakeCorrection` | ❌ missing | **Add.** Learning loop capture for user overrides. |

**Enum additions:** `DocumentQueueStatus`, `BillAllocationType`, `BillMatchCandidateType`, `BillMatchAction`, `BillCorrectionType`, `SupplierAliasSource`.

**Note:** Existing `AllocationStatus` enum values covering `UNALLOCATED/SUGGESTED/MATCHED/EXCEPTION/...` can be reused for `SupplierBillLine.allocationStatus`; we add `PARTIAL` and `SPLIT` if not already present.

---

## 4. Per-layer assessment

### 4.1 Ingestion layer (source → IntakeDocument)

| Source | Exists? | Gap |
|---|---|---|
| Zoho pull | ✅ | Needs to also create an `IntakeDocument{sourceType: ZOHO_PULL}` alongside the existing `IngestionEvent` so status is uniform. |
| Email / Outlook | partial | `scripts/email-poller.js` exists; no scheduled worker feeds `IntakeDocument`. Phase 3 stub only. |
| PDF upload | partial | `/api/supplier-bills/parse-pdf` extracts text but doesn't enter the queue. Phase 3 adds the enqueue step. |
| OCR | ❌ | `tesseract.js` is installed. Stub runner in Phase 3; mark `OCR_REQUIRED` for now. |
| Manual entry | implicit | A UI exists; no queue integration. Phase 3 adds entry endpoint. |

### 4.2 Parser layer

- `bill-parser.ts` handles generic tabular + Kerridge K8 + Zoho-style. Reuse verbatim inside the new `bill-extractor` worker.
- `zoho-parser.ts` handles Zoho payload shape. Reuse inside the ZOHO_PULL path.
- Gap: no confidence score output per-line. Phase 3 threads `parseConfidence` through.

### 4.3 Matching layer

- `auto-link-bill-line.ts` covers: SKU extraction, token overlap, UOM-aware qty (M ↔ LENGTH), MOQ overbuy flag.
- Gap: no supplier/entity/site signals, no alias lookups, no product-mapping history lookup, no per-candidate audit row.
- Phase 4 adds `match-engine.ts` that sits around the existing code and produces `BillLineMatch` rows + overall score.

### 4.4 Allocation layer

- `auto-allocator.ts` writes `CostAllocation` only. No split. No stock/returns surplus routing. No grouped purchase.
- Phase 5 adds `allocation-engine.ts` which writes `BillLineAllocation` rows first, then downstream `CostAllocation`/`StockExcessRecord`/`Return`/`AbsorbedCostAllocation` as needed.

### 4.5 Duplicate detection

- None. Phase 3 adds checksum (`sha256(supplier|billNo|total|date)`) and a hash column on `SupplierBill`.

### 4.6 Learning loop

- No correction capture, no feedback into matching.
- Phase 3/4 add `BillIntakeCorrection`. Corrections drive new `SupplierProductMapping` rows automatically.

---

## 5. Routes & UI

- `/api/supplier-bills/auto-link` — keep, will call match-engine in addition to legacy auto-link.
- `/api/supplier-bills/lines/[id]/suggestions` — keep, extended to capture corrections.
- `/api/intake/queue` — **new** (Phase 3). GET returns counts by `DocumentQueueStatus`; POST `{action:"tick"}` runs pending workers.
- `procurement-view.tsx` — **do not touch** (user iterating). New data flows surface automatically via the same API endpoints it already calls; any new UI goes in a separate tab.

---

## 6. Proceed plan (Phases 2–5 summary)

- **Phase 2**: Add 6 new models + 6 new enums; extend `SupplierBill` and `SupplierBillLine` with intake/duplicate/UOM columns; generate migration `bills_intake_engine`.
- **Phase 3**: Create `src/lib/intake/` with queue + worker scaffolds + real bill-extractor + duplicate-detector + match/allocation/post runners. Add `/api/intake/queue`.
- **Phase 4**: Multi-signal match-engine writing `BillLineMatch`. Wired alongside existing `autoLinkBillLine` so current behaviour is unchanged.
- **Phase 5**: Allocation-engine writing `BillLineAllocation`. MOQ / grouped / stock / returns / overhead / unresolved handled. Sums enforced.
- **Acceptance**: `scripts/test-intake-engine.mjs` seeds a supplier + 2 tickets + a bill with 3 lines covering clean match, MOQ overbuy, grouped purchase; asserts allocation sums.

No existing working code is rewritten. All additions coexist with the current path.
