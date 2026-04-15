import { prisma } from "@/lib/prisma";
import { parseBillText } from "@/lib/ingestion/bill-parser";
import { processBill } from "@/lib/finance/bill-processor";
import { runThreeWayMatch } from "@/lib/finance/three-way-match";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { createBillNeedsReviewTask } from "@/lib/ingestion/auto-action";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/automation/process-bills
 *
 * Standalone endpoint that finds all CLASSIFIED ingestion events with
 * eventKind = "BILL_DOCUMENT" that haven't been processed yet and runs
 * the bill processing pipeline on each one.
 *
 * Can be called by a cron job, the trickle-down orchestrator, or manually.
 * Idempotent — safe to call repeatedly; duplicate bills are never created.
 */
export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;
  const startedAt = Date.now();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100);

  try {
    // Find CLASSIFIED BILL_DOCUMENT events that haven't been actioned
    const events = await prisma.ingestionEvent.findMany({
      where: {
        eventKind: "BILL_DOCUMENT",
        status: "CLASSIFIED",
      },
      include: {
        parsedMessages: { select: { extractedText: true, structuredData: true } },
      },
      orderBy: { receivedAt: "asc" },
      take: limit,
    });

    if (events.length === 0) {
      // Even with no new events, run 3-way match so prior AWAITING_DELIVERY
      // bills can be promoted/demoted when delivery signals arrive separately.
      let threeWayMatch: Awaited<ReturnType<typeof runThreeWayMatch>> | null = null;
      try {
        threeWayMatch = await runThreeWayMatch({ limit: 50 });
      } catch (err) {
        console.error("[process-bills] 3-way match (no-events branch) failed:", err);
      }
      return Response.json({
        ok: true && (threeWayMatch?.ok ?? true),
        scanned: 0,
        processed: 0,
        failed: 0,
        message: "No unprocessed BILL_DOCUMENT events",
        durationMs: Date.now() - startedAt,
        threeWayMatch: threeWayMatch
          ? {
              scanned: threeWayMatch.scanned,
              matched: threeWayMatch.matched,
              disputed: threeWayMatch.disputed,
              variance: threeWayMatch.variance,
              awaitingDelivery: threeWayMatch.awaitingDelivery,
              awaitingBill: threeWayMatch.awaitingBill,
              orphanBill: threeWayMatch.orphanBill,
              partial: threeWayMatch.partial,
              failed: threeWayMatch.failed,
              outcomes: threeWayMatch.outcomes,
              errors: threeWayMatch.errors,
            }
          : { error: "3-way match step threw — see server logs" },
      });
    }

    let processed = 0;
    let failed = 0;
    const results: Array<{
      eventId: string;
      billNo: string | null;
      supplier: string | null;
      success: boolean;
      details: string;
      error?: string;
    }> = [];

    for (const event of events) {
      try {
        const text = event.parsedMessages?.[0]?.extractedText || "";
        const data = (event.parsedMessages?.[0]?.structuredData || {}) as Record<string, any>;
        const fromEmail = data.from?.address || "";
        const fromName = data.from?.name || "";

        // Extract PDF text from the parsed message text
        let pdfText = "";
        const attachmentMarker = text.indexOf("--- ");
        if (attachmentMarker !== -1) {
          pdfText = text.substring(attachmentMarker);
        }

        // Fallback: read from disk
        if (!pdfText) {
          const attachDir = path.join(process.cwd(), "public", "email-attachments");
          const eventPrefix = event.id.slice(0, 8);
          try {
            if (fs.existsSync(attachDir)) {
              const files = fs.readdirSync(attachDir);
              const pdfs = files.filter(
                (f) => f.startsWith(eventPrefix) && f.toLowerCase().endsWith(".pdf")
              );
              for (const pdfFile of pdfs) {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const pdfParse = require("pdf-parse/lib/pdf-parse");
                  const buffer = fs.readFileSync(path.join(attachDir, pdfFile));
                  const parsed = await pdfParse(buffer);
                  pdfText += `\n--- ${pdfFile} ---\n${parsed.text || ""}`;
                } catch (pdfErr) {
                  console.warn(`[process-bills] PDF parse failed for ${pdfFile}:`, pdfErr);
                }
              }
            }
          } catch {
            // continue
          }
        }

        const billText = pdfText || text;
        if (!billText.trim()) {
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: { status: "NEEDS_REVIEW", errorMessage: "BILL_DOCUMENT classified but no text extractable" },
          });
          await createBillNeedsReviewTask(
            event.id, data.subject || "", fromEmail, fromName,
            "no PDF text could be extracted from the email attachment",
          );
          failed++;
          results.push({
            eventId: event.id,
            billNo: null,
            supplier: null,
            success: false,
            details: "No extractable text",
          });
          continue;
        }

        // Parse the bill
        const parsed = parseBillText(billText);

        if (parsed.lines.length === 0 && !parsed.billNo) {
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: { status: "NEEDS_REVIEW", errorMessage: "Bill text parsed but no lines or bill number found" },
          });
          await createBillNeedsReviewTask(
            event.id, data.subject || "", fromEmail, fromName,
            "bill parser returned no line items and no bill number",
          );
          failed++;
          results.push({
            eventId: event.id,
            billNo: null,
            supplier: null,
            success: false,
            details: "Parser returned no lines and no bill number",
          });
          continue;
        }

        // Match supplier
        const supplierMatch = await matchSupplierFromEmail(fromEmail, fromName, data.subject || "");
        if (!supplierMatch) {
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: {
              status: "NEEDS_REVIEW",
              errorMessage: `No supplier match for ${fromName} <${fromEmail}>`,
            },
          });
          await createBillNeedsReviewTask(
            event.id, data.subject || "", fromEmail, fromName,
            `no supplier match for ${fromName || fromEmail || "sender"} (parsed billNo: ${parsed.billNo || "unknown"})`,
          );
          failed++;
          results.push({
            eventId: event.id,
            billNo: parsed.billNo,
            supplier: null,
            success: false,
            details: `No supplier match for ${fromEmail}`,
          });
          continue;
        }

        // Idempotency check
        const billNo = parsed.billNo || `AUTO-${event.id.slice(0, 8)}`;
        const existingBill = await prisma.supplierBill.findFirst({
          where: { supplierId: supplierMatch.supplierId, billNo },
        });

        if (existingBill) {
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: { status: "ACTIONED" },
          });
          processed++;
          results.push({
            eventId: event.id,
            billNo,
            supplier: supplierMatch.supplierName,
            success: true,
            details: `Bill already exists (${existingBill.id}) — skipped duplicate`,
          });
          continue;
        }

        // Create bill + lines
        const totalCost = parsed.grandTotal ?? parsed.lines.reduce((sum, l) => sum + l.lineTotal, 0);
        const billDate = parsed.billDate ? new Date(parsed.billDate) : new Date();

        const bill = await prisma.$transaction(async (tx) => {
          const created = await tx.supplierBill.create({
            data: {
              supplierId: supplierMatch.supplierId,
              billNo,
              billDate,
              status: "PENDING",
              totalCost,
              customerRef: parsed.customerRef ?? undefined,
              siteRef: parsed.siteRef ?? undefined,
              sourceAttachmentRef: `ingestion:${event.id}`,
            },
          });

          if (parsed.lines.length > 0) {
            await tx.supplierBillLine.createMany({
              data: parsed.lines.map((line) => ({
                supplierBillId: created.id,
                description: line.description,
                productCode: line.productCode,
                qty: line.qty,
                unitCost: line.unitCost,
                lineTotal: line.lineTotal,
                vatAmount: line.vatAmount,
                costClassification: "BILLABLE" as const,
                allocationStatus: "UNALLOCATED" as const,
              })),
            });
          }

          return created;
        });

        // Process bill (AP journal + line matching)
        let processingDetails = "";
        try {
          const result = await processBill(bill.id);
          processingDetails = `journal: ${result.journalEntryId ? "created" : "skipped"}, matched: ${result.matchSummary.matched}/${result.matchSummary.totalLines}`;
        } catch (procErr) {
          processingDetails = `processBill error: ${procErr instanceof Error ? procErr.message : "unknown"}`;
        }

        // Mark as actioned
        await prisma.ingestionEvent.update({
          where: { id: event.id },
          data: { status: "ACTIONED" },
        });

        processed++;
        results.push({
          eventId: event.id,
          billNo,
          supplier: supplierMatch.supplierName,
          success: true,
          details: `Created bill ${bill.id}, ${parsed.lines.length} lines, total: ${totalCost.toFixed(2)}. ${processingDetails}`,
        });
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : "unknown error";
        console.error(`[process-bills] Failed for event ${event.id}:`, err);

        try {
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: { status: "NEEDS_REVIEW", errorMessage: `Auto-process failed: ${errorMsg}` },
          });
        } catch {
          // update itself failed — continue
        }

        results.push({
          eventId: event.id,
          billNo: null,
          supplier: null,
          success: false,
          details: "Processing failed",
          error: errorMsg,
        });
      }
    }

    // ── Phase 2: 3-way match. Runs AFTER all bill-creation work in this
    // invocation so any bill freshly created above is evaluated. Limit is
    // scanned + 25 to also pick up stragglers (AWAITING_DELIVERY from prior
    // runs that now have a delivery signal).
    let threeWayMatch: Awaited<ReturnType<typeof runThreeWayMatch>> | null = null;
    try {
      threeWayMatch = await runThreeWayMatch({ limit: events.length + 25 });
    } catch (err) {
      console.error("[process-bills] 3-way match failed:", err);
      threeWayMatch = null;
    }

    return Response.json({
      ok: failed === 0 && (threeWayMatch?.ok ?? true),
      scanned: events.length,
      processed,
      failed,
      durationMs: Date.now() - startedAt,
      results,
      threeWayMatch: threeWayMatch
        ? {
            scanned: threeWayMatch.scanned,
            matched: threeWayMatch.matched,
            disputed: threeWayMatch.disputed,
            variance: threeWayMatch.variance,
            awaitingDelivery: threeWayMatch.awaitingDelivery,
            awaitingBill: threeWayMatch.awaitingBill,
            orphanBill: threeWayMatch.orphanBill,
            partial: threeWayMatch.partial,
            failed: threeWayMatch.failed,
            outcomes: threeWayMatch.outcomes,
            errors: threeWayMatch.errors,
          }
        : { error: "3-way match step threw — see server logs" },
    });
  } catch (error) {
    console.error("[process-bills] Fatal error:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Process bills failed",
      },
      { status: 500 }
    );
  }
}

// ─── Supplier Matching (duplicated from auto-action for standalone use) ────

async function matchSupplierFromEmail(
  fromEmail: string,
  fromName: string,
  subject: string
): Promise<{ supplierId: string; supplierName: string } | null> {
  const domain = (fromEmail.split("@")[1] || "").toLowerCase();
  const domainBase = domain.replace(/\.(co\.uk|com|org|net|ltd|uk)$/g, "").replace(/\./g, " ");
  const combined = `${fromName} ${subject} ${domainBase}`.toLowerCase();

  const ALIASES: Record<string, string[]> = {
    "f w hipkin": ["verdis", "fwhipkin", "hipkin"],
    "wolseley": ["wolseley", "plumb center", "plumbcenter"],
    "city plumbing": ["cityplumbing", "city plumbing"],
  };

  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, email: true } });

  // Direct email domain match
  if (domain) {
    for (const s of suppliers) {
      if (s.email && s.email.toLowerCase().includes(domain)) {
        return { supplierId: s.id, supplierName: s.name };
      }
    }
  }

  // Name words in combined text
  for (const s of suppliers) {
    const nameWords = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matchCount = nameWords.filter(
      (w) => combined.includes(w) || domainBase.includes(w)
    ).length;
    if (matchCount >= 2 || (matchCount >= 1 && nameWords.length <= 2)) {
      return { supplierId: s.id, supplierName: s.name };
    }
  }

  // Known aliases
  for (const [canonicalFragment, aliases] of Object.entries(ALIASES)) {
    const aliasHit = aliases.some(
      (a) => combined.includes(a) || domainBase.includes(a)
    );
    if (aliasHit) {
      const supplier = suppliers.find((s) =>
        s.name.toLowerCase().includes(canonicalFragment)
      );
      if (supplier) {
        return { supplierId: supplier.id, supplierName: supplier.name };
      }
    }
  }

  // Domain base fuzzy match
  if (domainBase.length >= 3) {
    for (const s of suppliers) {
      const lowerName = s.name.toLowerCase();
      if (lowerName.includes(domainBase) || domainBase.includes(lowerName.split(" ")[0])) {
        return { supplierId: s.id, supplierName: s.name };
      }
    }
  }

  return null;
}
