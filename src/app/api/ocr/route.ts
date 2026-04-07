import path from "path";
import fs from "fs";
import { execSync } from "child_process";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Save temp file
    const tmpDir = path.join(process.cwd(), "public", "tmp-ocr");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const ext = file.name.split(".").pop() || "png";
    const tmpFile = path.join(tmpDir, `ocr_${Date.now()}.${ext}`);
    const outBase = tmpFile.replace(/\.\w+$/, "_out");
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpFile, buffer);

    // Run tesseract CLI
    execSync(`tesseract "${tmpFile}" "${outBase}" --psm 6 -l eng`, { timeout: 30000 });
    const text = fs.readFileSync(`${outBase}.txt`, "utf-8");

    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch {}
    try { fs.unlinkSync(`${outBase}.txt`); } catch {}

    return Response.json({ text, confidence: 90 });
  } catch (error) {
    console.error("OCR failed:", error);
    return Response.json({ error: "OCR failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}
