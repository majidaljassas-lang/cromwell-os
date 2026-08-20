import { prisma } from "@/lib/prisma";
import { allocateBillLines } from "@/lib/bills/ai-allocator";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!bill) {
    return Response.json({ error: "Supplier bill not found" }, { status: 404 });
  }

  const result = await allocateBillLines(id);
  return Response.json(result);
}
