/**
 * Generate the *bundled* invoice PDF — a single file containing in order:
 *   1. Customer PO (if any) — re-uses /api/customer-pos/[id]/generate-pdf if available,
 *      falls back to skipping if no PO PDF endpoint
 *   2. Invoice PDF        — re-uses /api/sales-invoices/[id]/generate-pdf
 *   3. Every POD attached to the invoice's ticket — PDFs embedded as-is,
 *      images rendered into a one-page PDF first
 *
 * Output saved to public/invoices/Cromwell-Invoice-{INV}-bundle.pdf and the
 * URL returned. This is what gets sent to the customer.
 */

import { prisma } from "@/lib/prisma";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";

export const maxDuration = 120;

type FetchPdfArgs = { url: string; baseUrl: string };

async function fetchPdfBytes({ url, baseUrl }: FetchPdfArgs): Promise<Uint8Array | null> {
  try {
    const full = url.startsWith("http") ? url : `${baseUrl}${url}`;
    const res = await fetch(full);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function loadFileAsPdfPages(out: PDFDocument, filePath: string, mimeType: string | null): Promise<number> {
  if (!fs.existsSync(filePath)) return 0;
  const buf = fs.readFileSync(filePath);

  if ((mimeType ?? "").includes("pdf") || filePath.toLowerCase().endsWith(".pdf")) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
    return pages.length;
  }

  // Image — embed into a new A4 page.
  let img;
  try {
    if ((mimeType ?? "").includes("png") || filePath.toLowerCase().endsWith(".png")) {
      img = await out.embedPng(buf);
    } else {
      img = await out.embedJpg(buf);
    }
  } catch {
    return 0;
  }

  const page = out.addPage([595.28, 841.89]); // A4 portrait
  const margin = 36;
  const maxW = page.getWidth() - margin * 2;
  const maxH = page.getHeight() - margin * 2;
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * ratio;
  const h = img.height * ratio;
  page.drawImage(img, {
    x: (page.getWidth() - w) / 2,
    y: (page.getHeight() - h) / 2,
    width: w,
    height: h,
  });
  return 1;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNo: true,
      ticketId: true,
      ticket: { select: { id: true } },
    },
  });
  if (!invoice) return Response.json({ error: "invoice not found" }, { status: 404 });

  const baseUrl = new URL(request.url).origin;

  // Step 1: trigger generation of the invoice PDF (writes to public/invoices/)
  const invoicePdfRes = await fetch(`${baseUrl}/api/sales-invoices/${id}/generate-pdf`, { method: "POST" });
  if (!invoicePdfRes.ok) {
    return Response.json({ error: "failed to generate invoice PDF" }, { status: 500 });
  }
  const invoicePdfMeta = await invoicePdfRes.json() as { path?: string; fileName?: string };
  if (!invoicePdfMeta.path) {
    return Response.json({ error: "invoice PDF generator returned no path" }, { status: 500 });
  }

  const out = await PDFDocument.create();

  // Step 2: optional Customer PO PDF (best-effort — skip if endpoint not present)
  if (invoice.ticket?.id) {
    const po = await prisma.customerPO.findFirst({
      where: { ticketId: invoice.ticket.id, NOT: { poNo: "" } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (po) {
      const poPdfRes = await fetch(`${baseUrl}/api/customer-pos/${po.id}/generate-pdf`, { method: "POST" }).catch(() => null);
      if (poPdfRes && poPdfRes.ok) {
        const j = await poPdfRes.json() as { path?: string };
        if (j.path) {
          const bytes = await fetchPdfBytes({ url: j.path, baseUrl });
          if (bytes) {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const pages = await out.copyPages(src, src.getPageIndices());
            for (const p of pages) out.addPage(p);
          }
        }
      }
    }
  }

  // Step 3: invoice PDF
  {
    const bytes = await fetchPdfBytes({ url: invoicePdfMeta.path, baseUrl });
    if (!bytes) return Response.json({ error: "failed to load invoice PDF" }, { status: 500 });
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }

  // Step 4: every POD attached to the ticket
  let podsAdded = 0;
  if (invoice.ticket?.id) {
    const pods = await prisma.pODDocument.findMany({
      where: { ticketId: invoice.ticket.id, fileRef: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileRef: true, mimeType: true },
    });
    for (const p of pods) {
      if (!p.fileRef) continue;
      podsAdded += await loadFileAsPdfPages(out, p.fileRef, p.mimeType);
    }
  }

  const outBytes = await out.save();
  const safeNo = (invoice.invoiceNo || invoice.id).replace(/[^a-zA-Z0-9-]/g, "_");
  const fileName = `Cromwell-Invoice-${safeNo}-bundle.pdf`;
  const outDir = path.join(process.cwd(), "public", "invoices");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, outBytes);

  return Response.json({
    ok: true,
    fileName,
    path: `/invoices/${fileName}`,
    pageCount: out.getPageCount(),
    podsAdded,
  });
}
