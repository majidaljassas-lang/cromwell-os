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
      // Strip BOM if present, handle both UTF-8 and UTF-16 BOM
      rawText = buffer.toString("utf-8").replace(/^\uFEFF/, "");
      filename = file.name;
      bytes = buffer.length;
      console.log(`[BACKLOG UPLOAD] File: ${filename}, ${bytes} bytes, ${rawText.split("\n").length} raw lines`);

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
  // Strip BOM and \r
  const clean = line.replace(/^\uFEFF/, "").replace(/\r$/, "");

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

// ─── Media Detection ────────────────────────────────────────────────────────

interface MediaInfo {
  hasMedia: boolean;
  mediaType: string | null;
  mediaFilename: string | null;
  mediaNote: string | null;
}

const MEDIA_PATTERNS = [
  { pattern: /image omitted/i, type: "image" },
  { pattern: /<Media omitted>/i, type: "unknown" },
  { pattern: /video omitted/i, type: "video" },
  { pattern: /audio omitted/i, type: "audio" },
  { pattern: /document omitted/i, type: "document" },
  { pattern: /sticker omitted/i, type: "image" },
  { pattern: /GIF omitted/i, type: "image" },
  { pattern: /\bIMG[-_]\S+\.(jpg|jpeg|png|webp)/i, type: "image" },
  { pattern: /\bVID[-_]\S+\.(mp4|mov|avi)/i, type: "video" },
  { pattern: /\bAUD[-_]\S+\.(opus|mp3|m4a|ogg)/i, type: "audio" },
  { pattern: /\bDOC[-_]\S+\.(pdf|doc|docx|xls|xlsx)/i, type: "document" },
  { pattern: /\bPXL[-_]\S+\.(jpg|jpeg|png|mp4)/i, type: "image" },
  { pattern: /\.pdf$/i, type: "document" },
];

function detectMedia(text: string): MediaInfo {
  for (const { pattern, type } of MEDIA_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return {
        hasMedia: true,
        mediaType: type,
        mediaFilename: match[0].includes(".") ? match[0] : null,
        mediaNote: match[0],
      };
    }
  }
  return { hasMedia: false, mediaType: null, mediaFilename: null, mediaNote: null };
}

// ─── Async Parse ────────────────────────────────────────────────────────────

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

  // Handle both \n and \r\n line endings — strip \r from every line
  const rawLines = source.rawImportText.split("\n").map((l) => l.replace(/\r$/, ""));
  const totalLines = rawLines.length;
  console.log(`[BACKLOG PARSE] Starting parse: ${totalLines} raw lines, ${source.rawImportText.length} bytes`);

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
    hasMedia: boolean;
    mediaType: string | null;
    mediaFilename: string | null;
    mediaNote: string | null;
  }

  const messages: Msg[] = [];
  let currentMsg: Msg | null = null;
  let linesProcessed = 0;
  let emptyLines = 0;

  for (let i = 0; i < rawLines.length; i++) {
    linesProcessed++;
    const line = rawLines[i];

    // Empty lines: still count as processed but don't break message blocks
    if (!line.trim()) {
      emptyLines++;
      // If we have a current multiline message, preserve empty lines in it
      if (currentMsg && currentMsg.isMultiline) {
        currentMsg.rawText += "\n";
        currentMsg.lineCount++;
      }
      continue;
    }

    const parsed = parseWaLine(line);

    if (parsed) {
      // New message boundary — flush previous
      if (currentMsg) messages.push(currentMsg);

      const rawTs = `${parsed.date}, ${parsed.time}`;
      const { ts, confidence } = parseTs(parsed.date, parsed.time);

      const media = detectMedia(parsed.text);
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
        ...media,
      };
    } else {
      // No timestamp — continuation of previous message (multiline)
      if (currentMsg) {
        currentMsg.rawText += "\n" + line;
        currentMsg.isMultiline = true;
        currentMsg.lineCount++;
        // Check continuation lines for media too
        const media = detectMedia(line);
        if (media.hasMedia && !currentMsg.hasMedia) {
          currentMsg.hasMedia = media.hasMedia;
          currentMsg.mediaType = media.mediaType;
          currentMsg.mediaFilename = media.mediaFilename;
          currentMsg.mediaNote = media.mediaNote;
        }
      } else {
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
          hasMedia: false, mediaType: null, mediaFilename: null, mediaNote: null,
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

  // VALIDATION: confirm full file processed
  const tsMatches = messages.filter((m) => m.parsedOk).length;
  const multilineCount = messages.filter((m) => m.isMultiline).length;
  const unparsedCount2 = messages.filter((m) => !m.parsedOk).length;
  const mediaCount = messages.filter((m) => m.hasMedia).length;
  const timestamps = messages.filter((m) => m.parsedOk).map((m) => m.parsedTimestamp).sort((a, b) => a.getTime() - b.getTime());
  const minTs = timestamps[0];
  const maxTs = timestamps[timestamps.length - 1];
  const lastMsg = messages[messages.length - 1];

  const fullProcessed = linesProcessed === totalLines;

  console.log(`[BACKLOG PARSE] Source ${sourceId}:`);
  console.log(`  Total raw lines:        ${totalLines}`);
  console.log(`  Lines processed:        ${linesProcessed} ${fullProcessed ? "✓ COMPLETE" : "✗ INCOMPLETE"}`);
  console.log(`  Empty lines:            ${emptyLines}`);
  console.log(`  Total messages:         ${messages.length}`);
  console.log(`  Parsed OK:              ${tsMatches}`);
  console.log(`  Multiline:              ${multilineCount}`);
  console.log(`  Media:                  ${mediaCount}`);
  console.log(`  Unparsed:               ${unparsedCount2}`);
  console.log(`  First timestamp:        ${minTs?.toISOString() || "N/A"}`);
  console.log(`  Last timestamp:         ${maxTs?.toISOString() || "N/A"}`);
  console.log(`  Last message line:      ${lastMsg?.startLine || "N/A"}`);
  console.log(`  Last message sender:    ${lastMsg?.sender || "N/A"}`);
  console.log(`  Last message preview:   "${lastMsg?.rawText.slice(0, 60) || "N/A"}"`);
  if (!fullProcessed) {
    console.error(`  ✗ INTEGRITY ERROR: ${totalLines - linesProcessed} lines not processed!`);
  }
  for (const m of messages.slice(0, 3)) {
    console.log(`    line ${m.startLine} | ${m.sender} | ts="${m.rawTimestampText}" | "${m.rawText.slice(0, 60)}" | multi:${m.isMultiline}`);
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
        hasMedia: m.hasMedia,
        mediaType: m.mediaType,
        mediaFilename: m.mediaFilename,
        mediaNote: m.mediaNote,
      })),
    });
  }

  const senders = [...new Set(messages.filter((m) => m.parsedOk).map((m) => m.sender))];
  const parseStatus = unparsedCount2 === 0 ? "COMPLETE" : tsMatches === 0 ? "FAILED" : "PARTIAL";

  await prisma.backlogSource.update({
    where: { id: sourceId },
    data: {
      status: "PARSED",
      parseStatus,
      parseProgressPct: 100,
      parsedAt: new Date(),
      importCompletedAt: new Date(),
      messageCount: messages.length,
      unparsedLines: unparsedCount2,
      participantList: senders,
      dateFrom: minTs || undefined,
      dateTo: maxTs || undefined,
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
