import { runFullBackfill, backfillOutlookEmails, backfillWhatsApp } from "@/lib/forensic/gs8-backfill";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode || "full"; // "full" | "email" | "whatsapp"

    let result;
    if (mode === "email") {
      result = { email: await backfillOutlookEmails() };
    } else if (mode === "whatsapp") {
      result = { whatsapp: await backfillWhatsApp() };
    } else {
      result = await runFullBackfill();
    }

    return Response.json(result);
  } catch (error) {
    console.error("GS8 forensic backfill failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return current state of the forensic case
  const { prisma } = await import("@/lib/prisma");

  const caseData = await prisma.backlogCase.findFirst({
    where: { name: "GS8-FORENSIC" },
  });

  if (!caseData) {
    return Response.json({ exists: false, messageCount: 0 });
  }

  const messageCount = await prisma.backlogMessage.count({
    where: { sourceId: caseData.id },
  });

  // Get breakdown by channel
  const messages = await prisma.backlogMessage.findMany({
    where: { sourceId: caseData.id },
    select: { notes: true },
  });

  let emailCount = 0;
  let whatsappCount = 0;
  const siteRefs = new Set<string>();
  const senders = new Set<string>();

  for (const m of messages) {
    try {
      const notes = JSON.parse(m.notes || "{}");
      if (notes.channel === "EMAIL") emailCount++;
      else if (notes.channel === "WHATSAPP") whatsappCount++;
      if (notes.siteRefs) {
        for (const s of notes.siteRefs) siteRefs.add(s);
      }
    } catch {}
  }

  return Response.json({
    exists: true,
    caseId: caseData.id,
    messageCount,
    emailCount,
    whatsappCount,
    sitesDetected: [...siteRefs],
  });
}
