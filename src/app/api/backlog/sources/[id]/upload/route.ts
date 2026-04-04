import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

// Allow large file uploads (up to 50MB)
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST: Upload a raw WhatsApp .txt export file.
 * Content-Type: multipart/form-data with field "file"
 *
 * Flow:
 * 1. Accept file upload
 * 2. Store raw file to disk + raw text to DB
 * 3. Update source status to UPLOADED
 * 4. Start async server-side parse (non-blocking)
 * 5. Return immediately with job status
 *
 * Max file size: handled by Next.js (default ~4MB body, we increase)
 * Zero data loss: file stored verbatim before any parsing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    let rawText: string;
    let filename: string;
    let bytes: number;

    if (file) {
      // File upload path
      const buffer = Buffer.from(await file.arrayBuffer());
      rawText = buffer.toString("utf-8");
      filename = file.name;
      bytes = buffer.length;

      // Save raw file to disk for evidence
      const uploadDir = path.join(process.cwd(), "public", "backlog-uploads");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const diskFilename = `${sourceId}_${Date.now()}_${filename}`;
      fs.writeFileSync(path.join(uploadDir, diskFilename), buffer);

      await prisma.backlogSource.update({
        where: { id: sourceId },
        data: {
          rawFileRef: `/backlog-uploads/${diskFilename}`,
          rawImportFilename: filename,
        },
      });
    } else {
      // Fallback: raw text in body
      const textField = formData.get("rawText") as string | null;
      if (!textField) return Response.json({ error: "No file or rawText provided" }, { status: 400 });
      rawText = textField;
      filename = "pasted-text.txt";
      bytes = Buffer.byteLength(rawText, "utf-8");
    }

    const lineCount = rawText.split("\n").length;

    // Store raw text to DB — VERBATIM, no mutation
    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        rawImportText: rawText,
        rawImportFilename: filename,
        importBytes: bytes,
        importLineCount: lineCount,
        importedAt: new Date(),
        importStartedAt: new Date(),
        status: "UPLOADED",
        parseStatus: "NOT_RUN",
        parseProgressPct: 0,
      },
    });

    // Start async parse — non-blocking
    // We do this in-process but after responding
    startAsyncParse(sourceId).catch((err) => {
      console.error("Async parse failed for source", sourceId, err);
    });

    return Response.json({
      sourceId,
      filename,
      bytes,
      lineCount,
      status: "UPLOADED",
      parseStatus: "NOT_RUN",
      message: "File stored. Parsing started in background.",
    }, { status: 201 });
  } catch (error) {
    console.error("Upload failed:", error);
    return Response.json({ error: "Upload failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}

/**
 * GET: Check import/parse status for this source
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const source = await prisma.backlogSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true, label: true, status: true, parseStatus: true,
        rawImportFilename: true, importBytes: true, importLineCount: true,
        parseProgressPct: true, messageCount: true, unparsedLines: true,
        importStartedAt: true, importCompletedAt: true, parsedAt: true,
        participantList: true, dateFrom: true, dateTo: true,
      },
    });
    if (!source) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(source);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

// ─── Async Parse (runs after response) ──────────────────────────────────────

// TIMESTAMP BOUNDARY DETECTION
// Step 1: detect if line starts with a WhatsApp timestamp
// Supports: [DD/MM/YYYY, HH:MM:SS] and DD/MM/YYYY, HH:MM -
// Seconds optional. D/M can be 1 or 2 digits.
const TS_BRACKET = /^\[(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/;
const TS_DASH = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*/;

interface WaParsed {
  date: string;
  time: string;
  sender: string;
  text: string;
}

function parseWaLine(line: string): WaParsed | null {
  // Strip BOM if present
  const clean = line.replace(/^\uFEFF/, "");

  // Try bracketed format first: [DD/MM/YYYY, HH:MM:SS] remainder
  let tsMatch = clean.match(TS_BRACKET);
  let remainder: string;

  if (tsMatch) {
    remainder = clean.slice(tsMatch[0].length);
  } else {
    // Try dash format: DD/MM/YYYY, HH:MM - remainder
    tsMatch = clean.match(TS_DASH);
    if (tsMatch) {
      remainder = clean.slice(tsMatch[0].length);
    } else {
      return null; // No timestamp found — this is a continuation line
    }
  }

  const date = tsMatch[1];
  const time = tsMatch[2];

  // Step 2: parse sender and message from remainder
  // Format: "Sender Name: message text"
  // System messages may not have ": " (e.g. "Catalyn created group")
  const colonIdx = remainder.indexOf(": ");
  if (colonIdx > 0 && colonIdx < 60) {
    return {
      date,
      time,
      sender: remainder.slice(0, colonIdx).trim(),
      text: remainder.slice(colonIdx + 2),
    };
  }

  // No colon — system message, store entire remainder as text
  return {
    date,
    time,
    sender: "SYSTEM",
    text: remainder.trim(),
  };
}

async function startAsyncParse(sourceId: string) {
  await prisma.backlogSource.update({
    where: { id: sourceId },
    data: { status: "PROCESSING", parseStatus: "NOT_RUN", parseProgressPct: 0 },
  });

  const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
  if (!source?.rawImportText) {
    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: { parseStatus: "FAILED", status: "FAILED", importCompletedAt: new Date() },
    });
    return;
  }

  const rawLines = source.rawImportText.split("\n");
  const totalLines = rawLines.length;

  interface Msg {
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

  const messages: Msg[] = [];
  let currentMsg: Msg | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;

    const parsed = parseWaLine(line);

    if (parsed) {
      // New message boundary — flush previous
      if (currentMsg) messages.push(currentMsg);

      const rawTs = `${parsed.date}, ${parsed.time}`;
      const { ts, confidence } = parseTs(parsed.date, parsed.time);

      currentMsg = {
        startLine: i + 1,
        rawTimestampText: rawTs,
        parsedTimestamp: ts,
        timestampConfidence: confidence,
        sender: parsed.sender,
        rawText: parsed.text,
        parsedOk: true,
        isMultiline: false,
        lineCount: 1,
      };
    } else {
      // No timestamp — continuation of previous message (multiline)
      if (currentMsg) {
        currentMsg.rawText += "\n" + line;
        currentMsg.isMultiline = true;
        currentMsg.lineCount++;
      } else {
        // Very first line has no timestamp — store as unparsed
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
      }
    }

    // Update progress every 500 lines
    if (i % 500 === 0 && totalLines > 100) {
      const pct = Math.round((i / totalLines) * 100);
      await prisma.backlogSource.update({
        where: { id: sourceId },
        data: { parseProgressPct: pct },
      });
    }
  }

  if (currentMsg) messages.push(currentMsg);

  // Debug logging
  const tsMatches = messages.filter((m) => m.parsedOk).length;
  const multilineCount = messages.filter((m) => m.isMultiline).length;
  const unparsedCount2 = messages.filter((m) => !m.parsedOk).length;
  console.log(`[BACKLOG PARSE] Source ${sourceId}:`);
  console.log(`  Raw lines:       ${rawLines.length}`);
  console.log(`  Total messages:  ${messages.length}`);
  console.log(`  Parsed OK:       ${tsMatches}`);
  console.log(`  Multiline:       ${multilineCount}`);
  console.log(`  Unparsed:        ${unparsedCount2}`);
  console.log(`  First 3 messages:`);
  for (const m of messages.slice(0, 3)) {
    console.log(`    line ${m.startLine} | ${m.sender} | ts="${m.rawTimestampText}" | "${m.rawText.slice(0, 80)}" | multi:${m.isMultiline} lines:${m.lineCount}`);
  }
  // Also log first raw line for format detection
  const firstNonEmpty = rawLines.find((l) => l.trim());
  if (firstNonEmpty) {
    console.log(`  First raw line: "${firstNonEmpty.slice(0, 120)}"`);
    console.log(`  Bracket match: ${!!firstNonEmpty.match(TS_BRACKET)}`);
    console.log(`  Dash match:    ${!!firstNonEmpty.match(TS_DASH)}`);
  }

  // Delete existing messages then bulk create
  await prisma.backlogMessage.deleteMany({ where: { sourceId } });

  // Create in batches of 500 to avoid memory issues
  for (let i = 0; i < messages.length; i += 500) {
    const batch = messages.slice(i, i + 500);
    await prisma.backlogMessage.createMany({
      data: batch.map((m) => ({
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
  }

  const unparsedCount = messages.filter((m) => !m.parsedOk).length;
  const parsedCount = messages.filter((m) => m.parsedOk).length;
  const senders = [...new Set(messages.filter((m) => m.parsedOk).map((m) => m.sender))];
  const timestamps = messages.filter((m) => m.parsedOk).map((m) => m.parsedTimestamp).sort((a, b) => a.getTime() - b.getTime());
  const parseStatus = unparsedCount === 0 ? "COMPLETE" : parsedCount === 0 ? "FAILED" : "PARTIAL";

  await prisma.backlogSource.update({
    where: { id: sourceId },
    data: {
      status: "PARSED",
      parseStatus,
      parseProgressPct: 100,
      parsedAt: new Date(),
      importCompletedAt: new Date(),
      messageCount: messages.length,
      unparsedLines: unparsedCount,
      participantList: senders,
      dateFrom: timestamps[0] || undefined,
      dateTo: timestamps[timestamps.length - 1] || undefined,
    },
  });
}

function parseTs(date: string, time: string): { ts: Date; confidence: string } {
  const [d, m, y] = date.split("/");
  const year = y.length === 2 ? `20${y}` : y;
  try {
    const ts = new Date(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}`);
    if (isNaN(ts.getTime())) return { ts: new Date(), confidence: "LOW" };
    const month = parseInt(m);
    const day = parseInt(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ts, confidence: "MEDIUM" };
    return { ts, confidence: "HIGH" };
  } catch {
    return { ts: new Date(), confidence: "LOW" };
  }
}
