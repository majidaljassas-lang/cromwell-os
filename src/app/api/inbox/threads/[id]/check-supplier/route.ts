/**
 * POST /api/inbox/threads/:id/check-supplier
 *
 * Pre-flight supplier resolution for the bill reaction. Returns:
 *   - resolved: true  + supplierId + supplierName when an alias / domain hit lands
 *   - resolved: false + sender info + top suggestedSuppliers (by name similarity)
 *
 * The UI uses this BEFORE firing PROCESS_BILL so it can pop an alias-link modal
 * instead of bouncing the bill into UNRESOLVED_SUPPLIER review.
 */
import { prisma } from "@/lib/prisma";

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com", "cromwellplumbing.co.uk",
]);

function extractDomain(email: string): string | null {
  const m = email.toLowerCase().match(/@([^\s>]+)/);
  return m ? m[1] : null;
}

function extractName(participant: string): string | null {
  const m = participant.match(/^\s*([^<]+?)\s*</);
  return m ? m[1].trim() : null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    select: { id: true, participants: true, subject: true, classification: true },
  });
  if (!thread) {
    return Response.json({ error: "thread not found" }, { status: 404 });
  }

  // Pull the most recent inbound message for sender info.
  const latestInbound = await prisma.inboxThreadMessage.findFirst({
    where: { threadId: id, sender: { not: null } },
    orderBy: { occurredAt: "desc" },
    select: { sender: true, snippet: true },
  });

  const senderRaw = latestInbound?.sender ?? null;
  const senderName = senderRaw ? extractName(senderRaw) : null;
  const senderEmail = senderRaw ? senderRaw.match(/[\w.\-+]+@[\w.\-]+/)?.[0] ?? null : null;
  const senderDomain = senderEmail ? extractDomain(senderEmail) : null;

  // Try resolution by name → alias → domain (mirrors src/lib/bills/supplier-resolver.ts).
  if (senderName) {
    const exact = await prisma.supplier.findFirst({
      where: { name: { equals: senderName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (exact) {
      return Response.json({
        resolved: true,
        supplierId: exact.id,
        supplierName: exact.name,
        via: "supplier-name",
      });
    }
    const alias = await prisma.supplierAlias.findFirst({
      where: { alias: { equals: senderName, mode: "insensitive" } },
      include: { supplier: { select: { id: true, name: true } } },
    });
    if (alias) {
      return Response.json({
        resolved: true,
        supplierId: alias.supplier.id,
        supplierName: alias.supplier.name,
        via: "alias-name",
      });
    }
  }

  if (senderDomain && !GENERIC_DOMAINS.has(senderDomain)) {
    const domainHit = await prisma.supplierAlias.findFirst({
      where: { source: "EMAIL_DOMAIN", alias: { equals: senderDomain, mode: "insensitive" } },
      include: { supplier: { select: { id: true, name: true } } },
    });
    if (domainHit) {
      return Response.json({
        resolved: true,
        supplierId: domainHit.supplier.id,
        supplierName: domainHit.supplier.name,
        via: "alias-domain",
      });
    }
  }

  // Unresolved — return sender info + top supplier candidates ranked by name token overlap.
  const allSuppliers = await prisma.supplier.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const haystack = [senderName, senderEmail, senderDomain, thread.subject ?? ""]
    .filter((s): s is string => !!s)
    .join(" ")
    .toLowerCase();

  const scored = allSuppliers
    .map((s) => {
      const tokens = s.name.toLowerCase().split(/[\s\-_/]+/).filter((t) => t.length >= 3);
      const score = tokens.reduce(
        (acc, t) => acc + (haystack.includes(t) ? 1 : 0),
        0,
      );
      return { ...s, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return Response.json({
    resolved: false,
    sender: {
      raw: senderRaw,
      name: senderName,
      email: senderEmail,
      domain: senderDomain && !GENERIC_DOMAINS.has(senderDomain) ? senderDomain : null,
    },
    suggestedSuppliers: scored.map(({ id, name, score }) => ({ id, name, score })),
    allSuppliers: allSuppliers.map(({ id, name }) => ({ id, name })),
  });
}
