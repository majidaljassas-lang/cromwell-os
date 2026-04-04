import { prisma } from "@/lib/prisma";

/**
 * POST: Parse raw text into BacklogMessages.
 *
 * MULTI-LINE MESSAGE HANDLING (CRITICAL):
 * - New message ONLY starts when timestamp detected
 * - Lines without timestamp belong to previous message
 * - Full block stored as ONE message
 *
 * TIMESTAMP ACCURACY (CRITICAL):
 * - raw_timestamp_text: always stored as-is
 * - parsed_timestamp: DateTime attempt
 * - timestamp_confidence: HIGH / MEDIUM / LOW
 *
 * ZERO DATA LOSS: Every line stored. Unparseable lines stored raw.
 *
 * Body: { confirm?: boolean }
 * - Without confirm: returns preview
 * - With confirm: true: creates messages
 */

interface ParsedMsg {
  startLine: number;
  rawTimestampText: string | null;
  parsedTimestamp: Date;
  timestampConfidence: string;
  sender: string;
  rawText: string;
  parsedOk: boolean;
  isMultiline: boolean;
  lineCount: number;
}

// Both WhatsApp formats:
// [13/11/2024, 12:16:37] Sender: Message
// 13/11/2024, 12:16 - Sender: Message
const WA_BRACKET = /^\[(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}:\d{2})\]\s*([^:]+):\s*([\s\S]*)/;
const WA_DASH = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*([^:]+):\s*([\s\S]*)/;
function matchWaLine(line: string): RegExpMatchArray | null { return line.match(WA_BRACKET) || line.match(WA_DASH); }

function parseTimestamp(date: string, time: string): { ts: Date; confidence: string } {
  const [d, m, y] = date.split("/");
  const year = y.length === 2 ? `20${y}` : y;
  const isoStr = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}`;

  try {
    const ts = new Date(isoStr);
    if (isNaN(ts.getTime())) return { ts: new Date(), confidence: "LOW" };

    // Check if date components are reasonable
    const month = parseInt(m);
    const day = parseInt(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { ts, confidence: "MEDIUM" };
    }

    return { ts, confidence: "HIGH" };
  } catch {
    return { ts: new Date(), confidence: "LOW" };
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const confirm = body.confirm === true;

    const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });
    if (!source.rawImportText) return Response.json({ error: "No raw text to parse. Import raw text first." }, { status: 422 });

    const rawLines = source.rawImportText.split("\n");
    const messages: ParsedMsg[] = [];
    let currentMsg: ParsedMsg | null = null;
    let unparsedCount = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];

      // Skip completely empty lines (but they don't break message blocks)
      if (!line.trim()) continue;

      // Try to match WhatsApp timestamp pattern
      const waMatch = matchWaLine(line);

      if (waMatch) {
        // New message starts — flush previous if exists
        if (currentMsg) {
          messages.push(currentMsg);
        }

        const [, date, time, sender, text] = waMatch;
        const rawTs = `${date}, ${time}`;
        const { ts, confidence } = parseTimestamp(date, time);

        currentMsg = {
          startLine: i + 1,
          rawTimestampText: rawTs,
          parsedTimestamp: ts,
          timestampConfidence: confidence,
          sender: sender.trim(),
          rawText: text.trim(),
          parsedOk: true,
          isMultiline: false,
          lineCount: 1,
        };
      } else {
        // No timestamp — this line belongs to previous message (multi-line)
        if (currentMsg) {
          // Append to current message
          currentMsg.rawText += "\n" + line;
          currentMsg.isMultiline = true;
          currentMsg.lineCount++;
        } else {
          // No previous message — store as standalone unparsed
          currentMsg = {
            startLine: i + 1,
            rawTimestampText: null,
            parsedTimestamp: new Date(),
            timestampConfidence: "LOW",
            sender: "UNKNOWN",
            rawText: line,
            parsedOk: false,
            isMultiline: false,
            lineCount: 1,
          };
          unparsedCount++;
        }
      }
    }

    // Flush last message
    if (currentMsg) messages.push(currentMsg);

    // Count unparsed (standalone unparsed messages)
    unparsedCount = messages.filter((m) => !m.parsedOk).length;
    const parsedCount = messages.filter((m) => m.parsedOk).length;
    const multilineCount = messages.filter((m) => m.isMultiline).length;
    const parseStatus = unparsedCount === 0 ? "COMPLETE" : parsedCount === 0 ? "FAILED" : "PARTIAL";

    // Preview mode
    if (!confirm) {
      return Response.json({
        preview: true,
        totalMessages: messages.length,
        parsedOk: parsedCount,
        unparsed: unparsedCount,
        multiline: multilineCount,
        parseStatus,
        sampleParsed: messages.filter((p) => p.parsedOk).slice(0, 5).map((p) => ({
          startLine: p.startLine,
          rawTimestampText: p.rawTimestampText,
          timestampConfidence: p.timestampConfidence,
          sender: p.sender,
          preview: p.rawText.slice(0, 100),
          isMultiline: p.isMultiline,
          lineCount: p.lineCount,
        })),
        sampleUnparsed: messages.filter((p) => !p.parsedOk).slice(0, 5).map((p) => ({
          startLine: p.startLine,
          rawText: p.rawText.slice(0, 100),
        })),
      });
    }

    // Confirm mode — write all messages
    await prisma.backlogMessage.deleteMany({ where: { sourceId } });

    await prisma.backlogMessage.createMany({
      data: messages.map((m) => ({
        sourceId,
        lineNumber: m.startLine,
        rawTimestampText: m.rawTimestampText,
        parsedTimestamp: m.parsedTimestamp,
        timestampConfidence: m.timestampConfidence,
        sender: m.sender,
        rawText: m.rawText,
        parsedOk: m.parsedOk,
        isMultiline: m.isMultiline,
        lineCount: m.lineCount,
        messageType: "UNCLASSIFIED",
        relationType: "NONE",
      })),
    });

    // Update source metadata
    const senders = [...new Set(messages.filter((m) => m.parsedOk).map((m) => m.sender))];
    const timestamps = messages.filter((m) => m.parsedOk).map((m) => m.parsedTimestamp).sort((a, b) => a.getTime() - b.getTime());

    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        parseStatus,
        parsedAt: new Date(),
        messageCount: messages.length,
        unparsedLines: unparsedCount,
        participantList: senders,
        dateFrom: timestamps[0] || undefined,
        dateTo: timestamps[timestamps.length - 1] || undefined,
        status: "PARSED",
      },
    });

    return Response.json({
      confirmed: true,
      totalMessages: messages.length,
      parsedOk: parsedCount,
      unparsed: unparsedCount,
      multiline: multilineCount,
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
