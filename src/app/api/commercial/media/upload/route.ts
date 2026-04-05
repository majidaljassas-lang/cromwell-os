import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * POST /api/commercial/media/upload
 *
 * Upload media files (images, PDFs, documents, voice notes) and create
 * MediaEvidence records linked to a backlog source.
 *
 * Content-Type: multipart/form-data
 * Fields:
 *   - file: the media file
 *   - sourceId: backlog source ID
 *   - siteId: site ID
 *   - sender: (optional) who sent it
 *   - timestamp: (optional) when it was sent
 *   - linkedMessageId: (optional) specific message it belongs to
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("file") as File[];
    const sourceId = formData.get("sourceId") as string | null;
    const siteId = formData.get("siteId") as string | null;
    const sender = formData.get("sender") as string | null;
    const timestamp = formData.get("timestamp") as string | null;
    const linkedMessageId = formData.get("linkedMessageId") as string | null;

    if (!sourceId || !siteId) {
      return Response.json({ error: "sourceId and siteId are required" }, { status: 400 });
    }

    if (files.length === 0) {
      return Response.json({ error: "No files provided" }, { status: 400 });
    }

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), "public", "media-evidence");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const created: string[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = path.extname(file.name).toLowerCase();
      const mediaType = classifyFileType(ext, file.type);

      // Save to disk
      const diskFilename = `${sourceId}_${Date.now()}_${file.name}`;
      const diskPath = path.join(uploadDir, diskFilename);
      fs.writeFileSync(diskPath, buffer);

      // Create MediaEvidence record
      const evidence = await prisma.mediaEvidence.create({
        data: {
          sourceChat: sourceId,
          linkedMessageId,
          sender,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          mediaType: mediaType as any,
          fileName: file.name,
          filePath: `/media-evidence/${diskFilename}`,
          fileSize: buffer.length,
          mimeType: file.type,
          processingStatus: "PENDING",
          evidenceRole: "UNKNOWN_MEDIA",
          roleConfidence: "LOW",
          siteId,
        },
      });

      created.push(evidence.id);
    }

    return Response.json({
      uploaded: created.length,
      ids: created,
    }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Media upload failed:", msg);
    return Response.json({ error: "Upload failed", detail: msg }, { status: 500 });
  }
}

function classifyFileType(ext: string, mimeType: string): string {
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp"].includes(ext)) return "IMAGE";
  if (ext === ".pdf") return "PDF";
  if ([".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"].includes(ext)) return "DOCUMENT";
  if ([".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac"].includes(ext)) return "VOICE_NOTE";
  if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) return "VIDEO";
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("audio/")) return "VOICE_NOTE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType === "application/pdf") return "PDF";
  return "DOCUMENT";
}
