import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, aliases } = body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const trimmed = name.trim();
    const customer = await prisma.customer.create({
      data: {
        name: trimmed,
        notes: "Created from Zoho cleanup workspace",
      },
      select: { id: true, name: true, legalName: true, companyNumber: true },
    });
    if (Array.isArray(aliases) && aliases.length > 0) {
      const cleanAliases = [
        ...new Set(aliases.map((a: unknown) => String(a).trim()).filter(Boolean)),
      ].filter((a) => a !== trimmed);
      if (cleanAliases.length > 0) {
        await prisma.customerAlias.createMany({
          data: cleanAliases.map((aliasText) => ({
            customerId: customer.id,
            aliasText,
            aliasSource: "ZOHO_CLEANUP",
            manualConfirmed: true,
            confidenceScore: 1,
          })),
          skipDuplicates: true,
        });
      }
    }
    return NextResponse.json({ customer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
