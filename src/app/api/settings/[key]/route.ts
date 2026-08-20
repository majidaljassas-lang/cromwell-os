import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return Response.json({ key, value: row?.value ?? null });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const body = await request.json();
  const value = String(body.value ?? "");
  const row = await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return Response.json(row);
}
