import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await prisma.pODDocument.findUnique({
    where: { id },
    select: { fileRef: true, fileName: true, mimeType: true },
  });
  if (!pod || !pod.fileRef) return NextResponse.json({ error: "no file" }, { status: 404 });
  if (!fs.existsSync(pod.fileRef)) return NextResponse.json({ error: "file missing on disk" }, { status: 404 });

  const buf = fs.readFileSync(pod.fileRef);
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": pod.mimeType ?? "application/octet-stream",
      "content-disposition": `inline; filename="${pod.fileName ?? id}"`,
    },
  });
}
