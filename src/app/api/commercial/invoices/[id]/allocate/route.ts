/**
 * POST /api/commercial/invoices/[id]/allocate
 *
 * DEPRECATED 2026-04-15 — CommercialInvoice is read-only. Invoice-line
 * allocation lives on SalesInvoice now. Use /api/sales-invoices/[id]/link-po
 * (or related SalesInvoice flows) instead.
 */
export async function POST(): Promise<Response> {
  return Response.json(
    {
      error:
        "CommercialInvoice allocation is deprecated. Use SalesInvoice via /api/sales-invoices/[id]/link-po.",
      deprecatedSince: "2026-04-15",
      replacement: "/api/sales-invoices/[id]/link-po",
    },
    { status: 410 }
  );
}

export async function PATCH(): Promise<Response> {
  return POST();
}
export async function PUT(): Promise<Response> {
  return POST();
}
export async function DELETE(): Promise<Response> {
  return POST();
}
