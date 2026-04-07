import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const enquiryId = formData.get("enquiryId") as string;
    const sourceType = formData.get("sourceType") as string;

    if (!file || !enquiryId) {
      return Response.json({ error: "File and enquiryId required" }, { status: 400 });
    }

    const outputDir = path.join(process.cwd(), "public", "enquiry-attachments");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const ext = file.name.split(".").pop() || "png";
    const fileName = `${enquiryId.slice(0, 8)}_${Date.now()}.${ext}`;
    const filePath = `/enquiry-attachments/${fileName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(outputDir, fileName), buffer);

    // Update enquiry with attachment path
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { rawFileRef: filePath },
    });

    return Response.json({ ok: true, filePath }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload attachment:", error);
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
}
