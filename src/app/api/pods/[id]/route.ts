import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await prisma.pODDocument.findUnique({ where: { id } });
  if (!pod) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (pod.fileRef) {
    try { fs.unlinkSync(pod.fileRef); } catch { /* file may already be gone */ }
  }
  await prisma.pODDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
