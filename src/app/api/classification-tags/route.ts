/**
 * GET /api/classification-tags — list active tags grouped by category.
 */
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tags = await prisma.classificationTag.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return Response.json({ tags });
}
