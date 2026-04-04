import { prisma } from "@/lib/prisma";

/**
 * POST: Parse raw text into BacklogMessages.
 *
 * STEP 2: Takes stored rawImportText, attempts to parse each line.
 * Lines that parse → parsedOk: true
 * Lines that fail → parsedOk: false, stored raw anyway
 * ZERO data loss. Every single line becomes a BacklogMessage.
 *
 * Body: { confirm?: boolean }
 * - Without confirm: returns preview (parsed + unparsed counts)
 * - With confirm: true: actually creates messages
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const confirm = body.confirm === true;

    const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
    if (!source.rawImportText) return Response.json({ error: "No raw text to parse. Import raw text first." }, { status: 422 });

    const rawLines = source.rawImportText.split("\n");
    const parsed: Array<{
      lineNumber: number;
      timestamp: Date;
      sender: string;
      rawText: string;
      parsedOk: boolean;
    }> = [];

    let unparsedCount = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!line.trim()) continue; // skip empty lines but don't lose them

      // Try WhatsApp format: "DD/MM/YYYY, HH:MM - Sender: Message"
      const waMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*([^:]+):\s*([\s\S]*)/);

      if (waMatch) {
        const [, date, time, sender, text] = waMatch;
        const [d, m, y] = date.split("/");
        const year = y.length === 2 ? `20${y}` : y;
        let ts: Date;
        try {
          ts = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}`);
          if (isNaN(ts.getTime())) throw new Error("Invalid date");
        } catch {
          // Date parse failed — store raw anyway
          ts = new Date();
          unparsedCount++;
          parsed.push({ lineNumber: i + 1, timestamp: ts, sender: "UNKNOWN", rawText: line, parsedOk: false });
          continue;
        }
        parsed.push({ lineNumber: i + 1, timestamp: ts, sender: sender.trim(), rawText: text.trim(), parsedOk: true });
      } else {
        // Cannot parse — store raw anyway with UNKNOWN sender. NEVER discard.
        unparsedCount++;
        parsed.push({ lineNumber: i + 1, timestamp: new Date(), sender: "UNKNOWN", rawText: line, parsedOk: false });
      }
    }

    const parsedCount = parsed.filter((p) => p.parsedOk).length;
    const parseStatus = unparsedCount === 0 ? "COMPLETE" : parsedCount === 0 ? "FAILED" : "PARTIAL";

    // Preview mode — don't write yet
    if (!confirm) {
      return Response.json({
        preview: true,
        totalLines: parsed.length,
        parsedOk: parsedCount,
        unparsed: unparsedCount,
        parseStatus,
        sampleParsed: parsed.filter((p) => p.parsedOk).slice(0, 5).map((p) => ({
          lineNumber: p.lineNumber,
          timestamp: p.timestamp.toISOString(),
          sender: p.sender,
          preview: p.rawText.slice(0, 80),
        })),
        sampleUnparsed: parsed.filter((p) => !p.parsedOk).slice(0, 5).map((p) => ({
          lineNumber: p.lineNumber,
          rawText: p.rawText.slice(0, 100),
        })),
      });
    }

    // Confirm mode — write all messages
    // Delete existing messages for this source first (re-parse)
    await prisma.backlogMessage.deleteMany({ where: { sourceId } });

    await prisma.backlogMessage.createMany({
      data: parsed.map((p) => ({
        sourceId,
        lineNumber: p.lineNumber,
        timestamp: p.timestamp,
        sender: p.sender,
        rawText: p.rawText,
        parsedOk: p.parsedOk,
        messageType: "UNCLASSIFIED",
        relationType: "NONE",
      })),
    });

    // Update source metadata
    const senders = [...new Set(parsed.filter((p) => p.parsedOk).map((p) => p.sender))];
    const timestamps = parsed.filter((p) => p.parsedOk).map((p) => p.timestamp).sort((a, b) => a.getTime() - b.getTime());

    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        parseStatus,
        parsedAt: new Date(),
        messageCount: parsed.length,
        unparsedLines: unparsedCount,
        participantList: senders,
        dateFrom: timestamps[0] || undefined,
        dateTo: timestamps[timestamps.length - 1] || undefined,
        status: "PARSED",
      },
    });

    return Response.json({
      confirmed: true,
      totalMessages: parsed.length,
      parsedOk: parsedCount,
      unparsed: unparsedCount,
      parseStatus,
      participants: senders,
      dateRange: {
        from: timestamps[0]?.toISOString() || null,
        to: timestamps[timestamps.length - 1]?.toISOString() || null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Backlog parse failed:", error);
    return Response.json({ error: "Parse failed" }, { status: 500 });
  }
}
