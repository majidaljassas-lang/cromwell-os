import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteName, aliases } = body ?? {};
    if (typeof siteName !== "string" || !siteName.trim()) {
      return NextResponse.json({ error: "siteName required" }, { status: 400 });
    }
    const cleanAliases = Array.isArray(aliases)
      ? [...new Set(aliases.map((a: unknown) => String(a).trim()).filter(Boolean))].filter(
          (a) => a !== siteName.trim()
        )
      : [];
    const site = await prisma.site.create({
      data: {
        siteName: siteName.trim(),
        aliases: cleanAliases,
        notes: "Created from Zoho cleanup workspace",
      },
      select: { id: true, siteName: true, siteCode: true, postcode: true, city: true },
    });
    return NextResponse.json({ site });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
