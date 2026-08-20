import { prisma } from "@/lib/prisma";
import { resequenceLines } from "@/lib/tickets/resequence-lines";

// Moves selected lines into a section. Guarantees a single contiguous
// section block (one header) by writing displayOrder via resequenceLines
// after the section label change.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;
  const body = (await request.json()) as {
    lineIds: string[];
    sectionLabel: string | null;
  };

  if (!Array.isArray(body.lineIds) || body.lineIds.length === 0) {
    return Response.json({ error: "lineIds required" }, { status: 400 });
  }

  const cleanLabel =
    body.sectionLabel === null ? null : (body.sectionLabel ?? "").trim() || null;

  // If joining an existing section, place the moved lines at the end of it
  // so they sit immediately after that section's last line. Otherwise
  // leave them in place (resequence will compact later).
  let newOrder: number | null = null;
  if (cleanLabel) {
    const last = await prisma.ticketLine.findFirst({
      where: { ticketId, sectionLabel: cleanLabel, id: { notIn: body.lineIds } },
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });
    newOrder = (last?.displayOrder ?? 0) + 1;
  }

  await prisma.$transaction(
    body.lineIds.map((id, i) =>
      prisma.ticketLine.update({
        where: { id },
        data: {
          sectionLabel: cleanLabel,
          ...(newOrder !== null ? { displayOrder: newOrder + i } : {}),
        },
      }),
    ),
  );

  await resequenceLines(ticketId);

  return Response.json({ ok: true, moved: body.lineIds.length });
}
