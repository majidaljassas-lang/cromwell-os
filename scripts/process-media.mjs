/**
 * Standalone media processing script.
 * Runs tesseract.js OCR on uploaded images, classifies, extracts order events.
 *
 * Usage: node scripts/process-media.mjs
 *
 * Connects directly to DB via pg Pool (same as app).
 */

import Tesseract from "tesseract.js";
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 60000,
});

const SITE_ID = "1e6797b3-c9ce-4b45-a264-213380a42f0f";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ─── Product normalization (simplified inline) ──────────────────────────────

const PRODUCT_RULES = [
  { patterns: [/plasterboard/i, /\bboard\b.*(?:siniat|gtec|standard)/i, /standard\s*board/i, /12\.?5\s*mm.*board/i], code: "PLASTERBOARD_12.5MM" },
  { patterns: [/15\s*mm.*board/i, /fire.*board/i, /fireline/i, /soundblock/i], code: "PLASTERBOARD_15MM" },
  { patterns: [/moisture.*board/i, /aqua.*board/i, /green.*board/i], code: "PLASTERBOARD_MOISTURE" },
  { patterns: [/c[-\s]?stud/i, /metal\s*stud/i, /CS70/i], code: "C_STUD" },
  { patterns: [/deep\s*flange/i, /track\s*deep/i, /u[-\s]?track.*deep/i], code: "TRACK_DEEP_FLANGE" },
  { patterns: [/track\s*standard/i, /u[-\s]?track.*standard/i, /72\s*mm\s*u\s*track(?!.*deep)/i], code: "TRACK_STANDARD" },
  { patterns: [/u[-\s]?track/i, /\btrack\b/i, /top\s*track/i, /bottom\s*track/i], code: "TRACK" },
  { patterns: [/flat\s*strap/i, /siniat\s*flat/i], code: "FLAT_STRAP" },
  { patterns: [/mineral\s*wool/i, /acoustic\s*roll/i, /insulation/i, /25\s*mm\s*mineral/i], code: "INSULATION_25MM" },
  { patterns: [/drywall\s*screw/i, /board\s*screw/i], code: "DRYWALL_SCREWS" },
  { patterns: [/wood\s*screw/i], code: "WOOD_SCREWS" },
  { patterns: [/easy\s*filler/i, /filler/i, /easifill/i], code: "FILLER" },
  { patterns: [/plaster.*bead/i, /galvanised.*bead/i, /angle\s*bead/i, /engle\s*bead/i], code: "PLASTER_BEAD" },
  { patterns: [/jointing\s*tape/i, /scrim/i, /joint\s*tape/i], code: "JOINTING_TAPE" },
  { patterns: [/grab\s*adhesive/i, /stick.*like/i], code: "GRAB_ADHESIVE" },
  { patterns: [/tile.*adhesive/i, /drywall\s*adhesive/i], code: "TILE_ADHESIVE" },
  { patterns: [/silicone\s*white/i], code: "SILICONE_WHITE" },
  { patterns: [/silicone\s*clear/i], code: "SILICONE_CLEAR" },
  { patterns: [/15\s*mm\s*copp?er/i], code: "COPPER_PIPE_15MM" },
  { patterns: [/22\s*mm\s*copp?er/i], code: "COPPER_PIPE_22MM" },
  { patterns: [/28\s*mm\s*copp?er/i], code: "COPPER_PIPE_28MM" },
];

function normalizeProduct(text) {
  const lower = text.toLowerCase();
  for (const rule of PRODUCT_RULES) {
    for (const p of rule.patterns) {
      if (p.test(lower)) return rule.code;
    }
  }
  return null;
}

function extractQtyUnit(text) {
  const noMatch = text.match(/(\d[\d,.]*)\s*(?:No|no|nr|nos|pcs?)\s*(?:of\s+)?/);
  if (noMatch) return { qty: parseFloat(noMatch[1].replace(/,/g, "")), unit: "EA" };
  const mMatch = text.match(/(\d[\d,.]*)\s*m\s+(?:of\s+)?/);
  if (mMatch) return { qty: parseFloat(mMatch[1].replace(/,/g, "")), unit: "M" };
  const m2Match = text.match(/(\d[\d,.]*)\s*m2\s+(?:of\s+)?/);
  if (m2Match) return { qty: parseFloat(m2Match[1].replace(/,/g, "")), unit: "M2" };
  const xMatch = text.match(/(\d+)\s*[xX×]/);
  if (xMatch) return { qty: parseInt(xMatch[1]), unit: "EA" };
  // Table-style: "430.00 no."
  const tableMatch = text.match(/(\d[\d,.]*)\s*(?:no\.?|ea\.?|pcs?\.?|m\.?|sqm)/i);
  if (tableMatch) return { qty: parseFloat(tableMatch[1].replace(/,/g, "")), unit: "EA" };
  const leadMatch = text.match(/^[•\-\s]*(\d[\d,.]*)\s+/);
  if (leadMatch) return { qty: parseFloat(leadMatch[1].replace(/,/g, "")), unit: "EA" };
  return null;
}

// ─── Classification ─────────────────────────────────────────────────────────

const ORDER_RE = [/quantity\s*required/i, /order\s*(received|confirmed|number)/i, /material\s*(list|schedule|order)/i, /call\s*off/i, /delivery\s*qty/i, /\d+\s*(no|pcs|ea|m|m2)\b/i, /item\s+.*qty/i, /please\s*(order|send)/i];
const DELIVERY_RE = [/deliver(y|ed)/i, /on\s*site/i, /install(ed|ation)/i, /received\b/i, /pod\b/i];
const INVOICE_RE = [/invoice\s*(no|number)/i, /amount\s*due/i, /vat\b/i, /sub\s*total/i, /total\s*£/i, /order\s*number.*A\d{5,}/i];
const PRODUCT_RE = [/product\s*schedule/i, /specification/i, /data\s*sheet/i, /technical/i, /proposal\s*no/i, /sku\b/i, /manufacturer/i];

function countMatches(text, patterns) {
  return patterns.filter(p => p.test(text)).length;
}

function classifyText(text) {
  const scores = {
    ORDER_EVIDENCE: countMatches(text, ORDER_RE),
    DELIVERY_EVIDENCE: countMatches(text, DELIVERY_RE),
    INVOICE_EVIDENCE: countMatches(text, INVOICE_RE),
    PRODUCT_REFERENCE: countMatches(text, PRODUCT_RE),
  };

  // Check for qty lines
  const lines = text.split("\n").filter(l => extractQtyUnit(l));
  if (lines.length > 0) scores.ORDER_EVIDENCE += lines.length;

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (best[0][1] === 0) return { role: "UNKNOWN_MEDIA", confidence: "LOW" };

  const conf = best[0][1] >= 3 ? "HIGH" : best[0][1] >= 2 ? "MEDIUM" : "LOW";
  return { role: best[0][0], confidence: conf };
}

function extractEvents(text) {
  const events = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const qu = extractQtyUnit(line);
    if (!qu) continue;
    const productCode = normalizeProduct(line);
    events.push({
      rawText: line,
      productCode,
      qty: qu.qty,
      rawUom: qu.unit,
      confidence: productCode ? "HIGH" : "LOW",
    });
  }
  return events;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting media processing...");
  console.log(`Tesseract.js version: ${Tesseract.PSM ? "v5" : "v4+"}`);

  // Get pending media with actual files
  const { rows: media } = await pool.query(`
    SELECT id, "mediaType", "fileName", "filePath", "rawText"
    FROM "MediaEvidence"
    WHERE "siteId" = $1 AND "processingStatus" = 'PENDING' AND "filePath" IS NOT NULL
    ORDER BY timestamp ASC
  `, [SITE_ID]);

  console.log(`Found ${media.length} pending media with files`);

  let processed = 0, ocrOk = 0, ocrFail = 0, totalEvents = 0;
  const classifiedCounts = {};

  // Create tesseract worker once — reuse for all images
  console.log("Initializing tesseract worker (downloading model ~4MB)...");
  const worker = await Tesseract.createWorker("eng");
  console.log("Worker ready.");

  for (const item of media) {
    processed++;
    const absPath = path.join(PUBLIC_DIR, item.filePath);

    if (!fs.existsSync(absPath)) {
      await updateMedia(item.id, { processingStatus: "FAILED", processingError: `File not found: ${absPath}` });
      ocrFail++;
      continue;
    }

    const stat = fs.statSync(absPath);
    const ext = (item.filePath || "").split(".").pop()?.toLowerCase();

    // Skip very small files
    if (stat.size < 3000) {
      await updateMedia(item.id, {
        processingStatus: "CLASSIFIED",
        evidenceRole: "IRRELEVANT",
        roleConfidence: "MEDIUM",
        classificationNotes: `File too small (${stat.size} bytes)`,
      });
      classifiedCounts["IRRELEVANT"] = (classifiedCounts["IRRELEVANT"] || 0) + 1;
      continue;
    }

    // Non-image files
    if (ext === "mp4" || ext === "mov") {
      await updateMedia(item.id, {
        processingStatus: "CLASSIFIED",
        evidenceRole: "UNKNOWN_MEDIA",
        roleConfidence: "LOW",
        classificationNotes: "Video file — manual review required",
      });
      classifiedCounts["UNKNOWN_MEDIA"] = (classifiedCounts["UNKNOWN_MEDIA"] || 0) + 1;
      continue;
    }

    if (ext === "opus" || ext === "ogg" || ext === "m4a" || ext === "mp3") {
      await updateMedia(item.id, {
        processingStatus: "PENDING",
        evidenceRole: "UNKNOWN_MEDIA",
        roleConfidence: "LOW",
        classificationNotes: "Voice note — requires transcription",
      });
      classifiedCounts["VOICE_NOTE_PENDING"] = (classifiedCounts["VOICE_NOTE_PENDING"] || 0) + 1;
      continue;
    }

    // OCR for images
    try {
      if (processed % 10 === 0) {
        console.log(`Processing ${processed}/${media.length}...`);
      }

      const { data } = await worker.recognize(absPath);
      const text = data.text.trim();
      const ocrConf = data.confidence;

      if (text.length < 5) {
        // No text — site photo or similar
        await updateMedia(item.id, {
          extractedText: text || null,
          extractionMethod: "TESSERACT_JS",
          processingStatus: "CLASSIFIED",
          evidenceRole: "UNKNOWN_MEDIA",
          roleConfidence: "LOW",
          classificationNotes: `OCR: ${text.length} chars, confidence ${ocrConf}% — likely site photo`,
        });
        classifiedCounts["UNKNOWN_MEDIA"] = (classifiedCounts["UNKNOWN_MEDIA"] || 0) + 1;
        ocrOk++;
        continue;
      }

      // Classify based on text
      const { role, confidence } = classifyText(text);
      const events = role === "ORDER_EVIDENCE" ? extractEvents(text) : [];
      totalEvents += events.length;

      const candidateProducts = [...new Set(events.map(e => e.productCode).filter(Boolean))];
      const candidateQtys = events.length > 0
        ? Object.fromEntries(events.filter(e => e.productCode).map(e => [e.productCode, e.qty]))
        : null;

      await updateMedia(item.id, {
        extractedText: text,
        extractionMethod: "TESSERACT_JS",
        processingStatus: "EXTRACTED",
        evidenceRole: role,
        roleConfidence: confidence,
        classificationNotes: `OCR: ${text.length} chars, engine confidence ${ocrConf}%. Events: ${events.length}`,
        candidateProducts,
        candidateQtys,
      });

      classifiedCounts[role] = (classifiedCounts[role] || 0) + 1;
      ocrOk++;
    } catch (err) {
      await updateMedia(item.id, {
        processingStatus: "FAILED",
        processingError: err.message || String(err),
      });
      ocrFail++;
    }
  }

  await worker.terminate();

  console.log("\n=== PROCESSING COMPLETE ===");
  console.log(`Total processed: ${processed}`);
  console.log(`OCR success: ${ocrOk}`);
  console.log(`OCR failed: ${ocrFail}`);
  console.log(`Candidate events: ${totalEvents}`);
  console.log(`Classification:`, classifiedCounts);

  await pool.end();
}

async function updateMedia(id, data, retries = 3) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue;
    // Map JS camelCase to DB column names
    const col = key === "processingStatus" ? '"processingStatus"' :
                key === "processingError" ? '"processingError"' :
                key === "evidenceRole" ? '"evidenceRole"' :
                key === "roleConfidence" ? '"roleConfidence"' :
                key === "classificationNotes" ? '"classificationNotes"' :
                key === "extractedText" ? '"extractedText"' :
                key === "extractionMethod" ? '"extractionMethod"' :
                key === "candidateProducts" ? '"candidateProducts"' :
                key === "candidateQtys" ? '"candidateQtys"' :
                `"${key}"`;

    if (key === "candidateProducts") {
      fields.push(`${col} = $${idx}::text[]`);
      values.push(val);
    } else if (key === "candidateQtys") {
      fields.push(`${col} = $${idx}::jsonb`);
      values.push(val ? JSON.stringify(val) : null);
    } else {
      fields.push(`${col} = $${idx}`);
      values.push(val);
    }
    idx++;
  }

  fields.push(`"updatedAt" = NOW()`);
  values.push(id);

  try {
    await pool.query(
      `UPDATE "MediaEvidence" SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
  } catch (err) {
    if (retries > 0) {
      console.log(`  DB write failed, retrying (${retries} left)...`);
      await new Promise(r => setTimeout(r, 2000));
      return updateMedia(id, data, retries - 1);
    }
    throw err;
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
