import { NextResponse } from "next/server";
import { mergeSuppliers } from "@/lib/suppliers/dedupe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { keeperId?: string; loserId?: string };
  if (!body.keeperId || !body.loserId) {
    return NextResponse.json(
      { error: "keeperId and loserId required" },
      { status: 400 },
    );
  }
  try {
    const result = await mergeSuppliers(body.keeperId, body.loserId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "merge failed" },
      { status: 500 },
    );
  }
}
