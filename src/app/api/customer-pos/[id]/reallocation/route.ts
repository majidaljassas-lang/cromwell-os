import { prisma } from "@/lib/prisma";

// Internal-only reallocation credit for a CustomerPO: one credit row, a ledger
// of draws, and the live remaining balance. Draws never exceed the credit.

async function loadCredit(customerPOId: string) {
  const credit = await prisma.reallocationCredit.findFirst({
    where: { customerPOId },
    include: { draws: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!credit) return null;
  const drawn = credit.draws.reduce((s, d) => s + Number(d.value), 0);
  const creditValue = Number(credit.creditValue);
  return {
    id: credit.id,
    sourceDescription: credit.sourceDescription,
    sourceQty: Number(credit.sourceQty),
    sourceUnitValue: Number(credit.sourceUnitValue),
    creditValue,
    notes: credit.notes,
    draws: credit.draws.map((d) => ({
      id: d.id,
      description: d.description,
      value: Number(d.value),
      createdAt: d.createdAt.toISOString(),
    })),
    drawn,
    remaining: Math.round((creditValue - drawn) * 100) / 100,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const credit = await loadCredit(id);
    return Response.json({ credit });
  } catch (error) {
    console.error("Failed to load reallocation credit:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load reallocation credit" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const description = String(body.description ?? "").trim();
    const value = Number(body.value);

    if (!description || !Number.isFinite(value) || value <= 0) {
      return Response.json(
        { error: "description and a positive value are required" },
        { status: 400 }
      );
    }

    const credit = await prisma.reallocationCredit.findFirst({
      where: { customerPOId: id },
      include: { draws: true },
    });
    if (!credit) {
      return Response.json({ error: "No reallocation credit for this PO" }, { status: 404 });
    }

    const nextOrder =
      credit.draws.reduce((m, d) => Math.max(m, d.displayOrder), 0) + 1;

    await prisma.reallocationDraw.create({
      data: { creditId: credit.id, description, value, displayOrder: nextOrder },
    });

    return Response.json({ credit: await loadCredit(id) }, { status: 201 });
  } catch (error) {
    console.error("Failed to add reallocation draw:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to add reallocation draw" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const drawId = new URL(request.url).searchParams.get("drawId");
    if (!drawId) {
      return Response.json({ error: "drawId query param is required" }, { status: 400 });
    }

    await prisma.reallocationDraw.delete({ where: { id: drawId } });

    return Response.json({ credit: await loadCredit(id) });
  } catch (error) {
    console.error("Failed to delete reallocation draw:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete reallocation draw" },
      { status: 500 }
    );
  }
}
