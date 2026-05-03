/**
 * Supplier resolution for bill ingestion.
 *
 * Tries name → SupplierAlias → email-domain match. Returns null if nothing
 * sticks — the caller is expected to park the upstream artefact (Bill,
 * IntakeDocument, etc.) and let the human triage via ReviewQueueItem.
 *
 * No more silent stub creation (2026-05-02).
 */

import { prisma } from "@/lib/prisma";
import { enqueueUnresolvedParty } from "@/lib/parties/review-queue";

export interface ResolveArgs {
  name: string | null;
  participants?: string[];
}

export async function resolveSupplier(args: ResolveArgs): Promise<string | null> {
  const { name, participants = [] } = args;

  if (name) {
    const exact = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (exact) return exact.id;

    const alias = await prisma.supplierAlias.findFirst({
      where: { alias: { equals: name, mode: "insensitive" } },
    });
    if (alias) return alias.supplierId;
  }

  // Email-domain fallback — pick the first non-generic domain in participants
  const domains = participants
    .map((p) => p.toLowerCase().match(/@([^\s>]+)/)?.[1])
    .filter((d): d is string => !!d)
    .filter((d) => !GENERIC_DOMAINS.has(d));

  for (const domain of domains) {
    const hit = await prisma.supplierAlias.findFirst({
      where: { source: "EMAIL_DOMAIN", alias: { equals: domain, mode: "insensitive" } },
    });
    if (hit) return hit.supplierId;
  }

  const rawValue = name || domains[0] || "(unknown)";
  await enqueueUnresolvedParty({
    party: "SUPPLIER",
    rawValue,
    description: `Bill pipeline could not resolve supplier "${rawValue}"${domains.length ? ` (domains: ${domains.join(", ")})` : ""}`,
  });

  return null;
}

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com",
]);
