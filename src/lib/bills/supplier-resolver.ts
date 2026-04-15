/**
 * Supplier resolution for bill ingestion.
 *
 * Tries name → SupplierAlias → email-domain match. If nothing sticks, creates
 * a stub so the bill can still enter the pipeline — a human triage step can
 * merge stubs later.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export interface ResolveArgs {
  name: string | null;
  participants?: string[];
}

export async function resolveSupplier(args: ResolveArgs): Promise<string> {
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

  const stubName = name || (domains[0] ? `Supplier @ ${domains[0]}` : "Unknown Supplier");
  const stub = await prisma.supplier.create({ data: { name: stubName } });

  await logAudit({
    objectType: "Supplier",
    objectId:   stub.id,
    actionType: "STUB_CREATED",
    actor:      "SYSTEM",
    newValue:   { source: "bill-pipeline", extractedName: name, domains },
  });

  return stub.id;
}

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com",
]);
