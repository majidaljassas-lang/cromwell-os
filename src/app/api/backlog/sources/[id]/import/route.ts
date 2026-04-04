import { prisma } from "@/lib/prisma";

/**
 * POST: Import raw text into a backlog source.
 *
 * STEP 1 ONLY: Store raw text exactly as-is. Do NOT parse. Do NOT interpret.
 * Body: { rawText: string }
 *
 * Raw text is stored on the source record. Parse runs separately via /parse endpoint.
 * NO message may be lost. NO interpretation at this stage.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const body = await request.json();
    const { rawText } = body;

    if (!rawText || typeof rawText !== "string") {
      return Response.json({ error: "rawText string required" }, { status: 400 });
    }

    const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

    // Store raw text — preserve exactly, NEVER interpret
    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        rawImportText: rawText,
        importedAt: new Date(),
        status: "RAW_STORED",
        parseStatus: "NOT_RUN",
      },
    });

    const lineCount = rawText.split("\n").filter((l: string) => l.trim()).length;

    return Response.json({
      stored: true,
      sourceId,
      rawLineCount: lineCount,
      parseStatus: "NOT_RUN",
      message: "Raw text stored. Run /parse as next step.",
    }, { status: 201 });
  } catch (error) {
    console.error("Backlog raw import failed:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
