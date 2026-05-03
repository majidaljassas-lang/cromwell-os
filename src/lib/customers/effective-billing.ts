/**
 * Resolve a customer's *effective* billing details by walking up the parent
 * chain. A null value on a subsidiary means "inherit from parent". The first
 * non-null value found anywhere up the chain wins.
 *
 * Trickle set (confirmed 2026-05-02):
 *   billingAddress, billingEmail, paymentTerms, creditLimit, vatNumber, currency
 *
 * Identity / per-legal-entity fields (legalName, companyNumber, name) do NOT
 * trickle. Override on the subsidiary by setting the field to a non-null value.
 * Reset to inherit by clearing the field back to null.
 *
 * Cycle-safe: bails after walking 8 levels even if data is inconsistent.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export type EffectiveBilling = {
  billingAddress: string | null;
  billingEmail: string | null;
  paymentTerms: string | null;
  creditLimit: Prisma.Decimal | null;
  vatNumber: string | null;
  currency: string | null;
  /** For each field: the customer id where the value was actually sourced. */
  sources: {
    billingAddress: string | null;
    billingEmail: string | null;
    paymentTerms: string | null;
    creditLimit: string | null;
    vatNumber: string | null;
    currency: string | null;
  };
};

const TRICKLE_FIELDS = [
  "billingAddress",
  "billingEmail",
  "paymentTerms",
  "creditLimit",
  "vatNumber",
  "currency",
] as const;

const MAX_DEPTH = 8;

export async function getEffectiveBillingDetails(customerId: string): Promise<EffectiveBilling | null> {
  const result: EffectiveBilling = {
    billingAddress: null,
    billingEmail: null,
    paymentTerms: null,
    creditLimit: null,
    vatNumber: null,
    currency: null,
    sources: {
      billingAddress: null,
      billingEmail: null,
      paymentTerms: null,
      creditLimit: null,
      vatNumber: null,
      currency: null,
    },
  };

  let cursor: string | null = customerId;
  const seen = new Set<string>();
  let depth = 0;

  while (cursor && depth < MAX_DEPTH) {
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const c: {
      id: string;
      parentCustomerEntityId: string | null;
      billingAddress: string | null;
      billingEmail: string | null;
      paymentTerms: string | null;
      creditLimit: Prisma.Decimal | null;
      vatNumber: string | null;
      currency: string | null;
    } | null = await prisma.customer.findUnique({
      where: { id: cursor },
      select: {
        id: true,
        parentCustomerEntityId: true,
        billingAddress: true,
        billingEmail: true,
        paymentTerms: true,
        creditLimit: true,
        vatNumber: true,
        currency: true,
      },
    });
    if (!c) break;

    let allFilled = true;
    for (const field of TRICKLE_FIELDS) {
      const current = result[field];
      const incoming = c[field];
      if (current === null && incoming !== null && incoming !== undefined) {
        if (field === "creditLimit") {
          result.creditLimit = incoming as Prisma.Decimal;
        } else {
          (result as Record<string, unknown>)[field] = incoming;
        }
        result.sources[field] = c.id;
      }
      if (result[field] === null) allFilled = false;
    }

    if (allFilled) break;
    cursor = c.parentCustomerEntityId;
    depth++;
  }

  return result;
}
