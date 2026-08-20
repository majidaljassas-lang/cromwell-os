/**
 * POST /api/suppliers/:id/aliases
 *
 * Body: { alias: string, source?: 'USER' | 'EMAIL_DOMAIN' | 'VAT' }
 *
 * Idempotent — uses the (supplierId, alias) unique constraint. If the row
 * already exists, returns it instead of erroring.
 */
import { prisma } from "@/lib/prisma";

const VALID_SOURCES = new Set(["USER", "EMAIL_DOMAIN", "VAT", "SYSTEM"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const aliasRaw = (body as { alias?: string }).alias?.trim();
  const source = (body as { source?: string }).source ?? "USER";

  if (!aliasRaw) {
    return Response.json({ error: "alias required" }, { status: 400 });
  }
  if (!VALID_SOURCES.has(source)) {
    return Response.json({ error: `invalid source '${source}'` }, { status: 400 });
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!supplier) {
    return Response.json({ error: "supplier not found" }, { status: 404 });
  }

  const created = await prisma.supplierAlias.upsert({
    where: { supplierId_alias: { supplierId: id, alias: aliasRaw } },
    create: {
      supplierId: id,
      alias: aliasRaw,
      source: source as "USER" | "EMAIL_DOMAIN" | "VAT" | "SYSTEM",
      observationCount: 1,
      lastSeenAt: new Date(),
    },
    update: {
      observationCount: { increment: 1 },
      lastSeenAt: new Date(),
    },
  });

  return Response.json({ ok: true, alias: created, supplier }, { status: 201 });
}
