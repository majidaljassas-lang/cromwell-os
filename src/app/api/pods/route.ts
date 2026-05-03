/**
 * POD endpoints.
 *   GET  /api/pods?ticketId=...           → list PODs for a ticket
 *   POST /api/pods                         → create POD (multipart/form-data with file, OR JSON for tracking-only)
 *
 * Files saved under public/pod/<ticketId>/ — fileRef is the absolute disk path.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const POD_TYPES = ["DELIVERY_NOTE", "IMAGE", "TRACKING_NOTE", "SIGNED_RECEIPT", "OTHER"] as const;
type PODType = (typeof POD_TYPES)[number];

function isPodType(v: unknown): v is PODType {
  return typeof v === "string" && (POD_TYPES as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticketId = searchParams.get("ticketId");
  const ticketLineId = searchParams.get("ticketLineId");
  if (!ticketId && !ticketLineId) {
    return NextResponse.json({ error: "ticketId or ticketLineId required" }, { status: 400 });
  }

  const pods = await prisma.pODDocument.findMany({
    where: ticketLineId ? { ticketLineId } : { ticketId: ticketId! },
    orderBy: { createdAt: "desc" },
    include: { ticketLine: { select: { id: true, description: true, displayOrder: true } } },
  });

  return NextResponse.json({ pods });
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    return handleMultipart(req);
  }
  return handleJson(req);
}

async function handleJson(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId : null;
  const podType = body.podType;
  if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  if (!isPodType(podType)) return NextResponse.json({ error: "invalid podType" }, { status: 400 });

  const created = await prisma.pODDocument.create({
    data: {
      ticketId,
      ticketLineId: typeof body.ticketLineId === "string" ? body.ticketLineId : null,
      podType,
      trackingNumber: typeof body.trackingNumber === "string" ? body.trackingNumber : null,
      carrier:        typeof body.carrier        === "string" ? body.carrier        : null,
      supplierName:   typeof body.supplierName   === "string" ? body.supplierName   : null,
      signedBy:       typeof body.signedBy       === "string" ? body.signedBy       : null,
      signedAt:       typeof body.signedAt       === "string" ? new Date(body.signedAt) : null,
      notes:          typeof body.notes          === "string" ? body.notes          : null,
      uploadedBy:     typeof body.uploadedBy     === "string" ? body.uploadedBy     : "USER",
    },
  });

  return NextResponse.json({ ok: true, pod: created });
}

async function handleMultipart(req: Request) {
  const fd = await req.formData();
  const ticketId = String(fd.get("ticketId") ?? "");
  const ticketLineId = (fd.get("ticketLineId") as string | null) || null;
  const podTypeRaw = String(fd.get("podType") ?? "");
  const file = fd.get("file") as File | null;

  if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });
  if (!isPodType(podTypeRaw)) return NextResponse.json({ error: "invalid podType" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const uploadDir = path.join(process.cwd(), "public", "pod", ticketId);
  fs.mkdirSync(uploadDir, { recursive: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString("hex");
  const fileName = `${stamp}_${rand}_${safeName}`;
  const fullPath = path.join(uploadDir, fileName);

  const arrayBuf = await file.arrayBuffer();
  fs.writeFileSync(fullPath, Buffer.from(arrayBuf));

  const created = await prisma.pODDocument.create({
    data: {
      ticketId,
      ticketLineId,
      podType: podTypeRaw,
      fileRef: fullPath,
      fileName: file.name,
      mimeType: file.type || null,
      fileSize: file.size,
      trackingNumber: (fd.get("trackingNumber") as string | null) || null,
      carrier:        (fd.get("carrier")        as string | null) || null,
      supplierName:   (fd.get("supplierName")   as string | null) || null,
      signedBy:       (fd.get("signedBy")       as string | null) || null,
      signedAt:       (fd.get("signedAt")       as string | null) ? new Date(fd.get("signedAt") as string) : null,
      notes:          (fd.get("notes")          as string | null) || null,
      uploadedBy:     (fd.get("uploadedBy")     as string | null) || "USER",
    },
  });

  return NextResponse.json({ ok: true, pod: created });
}
