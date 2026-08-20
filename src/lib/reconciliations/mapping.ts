// Valsir → Geberit HDPE code mapping. Customer uses the old Valsir codes on
// their revised list, but verbally confirmed they want Geberit-branded stock.
// Any parent line whose description/code begins with "VS" gets swapped to the
// Geberit equivalent here. Re-costing is manual — we wipe the old cost/sale
// on apply so pricing doesn't silently carry forward.

import type { ReconciliationFlag } from "@/generated/prisma";

export type ValsirGeberitMap = {
  valsirCode: string;
  geberitCode: string;
  flag: ReconciliationFlag;
  note: string | null;
};

export const VALSIR_TO_GEBERIT: readonly ValsirGeberitMap[] = [
  {
    valsirCode: "VS0324004",
    geberitCode: "363.779.16.1",
    flag: "VERIFY",
    note: "Confirm whether capped adaptor variant is needed",
  },
  {
    valsirCode: "VS0312013",
    geberitCode: "367.275.16.1",
    flag: "VERIFY",
    note: "Confirm exact current Geberit code for 110×110 88.5° equal branch",
  },
  {
    valsirCode: "VS0310994",
    geberitCode: "367.445.16.1",
    flag: "OK",
    note: null,
  },
  {
    valsirCode: "VS0309013",
    geberitCode: "367.125.16.1",
    flag: "VERIFY",
    note: "Some sources list 110×75 — confirm 110×110 variant",
  },
  {
    valsirCode: "VS0348011",
    geberitCode: "367.451.16.1",
    flag: "OK",
    note: null,
  },
  {
    valsirCode: "VS0328012",
    geberitCode: "367.700.16.1",
    flag: "OK",
    note: null,
  },
  {
    valsirCode: "VS0300013",
    geberitCode: "367.000.16.0",
    flag: "PRICE_FIX",
    note: "Parent line currently shows −£5,056.73 margin. Re-cost fully",
  },
  {
    valsirCode: "VS0306013",
    geberitCode: "367.045.16.1",
    flag: "OK",
    note: null,
  },
  {
    valsirCode: "VS0350011",
    geberitCode: "367.771.16.1",
    flag: "OK",
    note: null,
  },
] as const;

const VALSIR_INDEX: Map<string, ValsirGeberitMap> = new Map(
  VALSIR_TO_GEBERIT.map((m) => [m.valsirCode, m]),
);

export function lookupValsir(code: string): ValsirGeberitMap | null {
  return VALSIR_INDEX.get(code) ?? null;
}

export function extractValsirCode(text: string): string | null {
  const match = text.match(/\bVS\d{7}\b/);
  return match ? match[0] : null;
}
