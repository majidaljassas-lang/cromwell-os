import { prisma } from "@/lib/prisma";
import { createConsent, isYapilyConfigured } from "@/lib/finance/yapily";

export async function POST(request: Request) {
  try {
    if (!isYapilyConfigured()) {
      return Response.json(
        { error: "Yapily is not configured. Set YAPILY_APP_UUID and YAPILY_APP_SECRET." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { institutionId, bankAccountId } = body;

    if (!institutionId) {
      return Response.json({ error: "institutionId is required" }, { status: 400 });
    }

    // Build callback URL
    const origin = request.headers.get("origin") || process.env.NEXTAUTH_URL || "http://localhost:3000";
    const callbackUrl = `${origin}/api/finance/bank/yapily/callback`;

    const consent = await createConsent(institutionId, callbackUrl);

    // Store the consent ID against the bank account if provided
    if (bankAccountId) {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          yapilyInstitutionId: institutionId,
        },
      });
    }

    // Store consent ID in SystemSetting for the callback to pick up
    await prisma.systemSetting.upsert({
      where: { key: "yapily_pending_consent_id" },
      create: { key: "yapily_pending_consent_id", value: consent.id },
      update: { value: consent.id },
    });

    if (bankAccountId) {
      await prisma.systemSetting.upsert({
        where: { key: "yapily_pending_bank_account_id" },
        create: { key: "yapily_pending_bank_account_id", value: bankAccountId },
        update: { value: bankAccountId },
      });
    }

    return Response.json({
      consentId: consent.id,
      authorisationUrl: consent.authorisationUrl,
      status: consent.status,
      message: "Redirect user to authorisationUrl to authorize bank access",
    });
  } catch (error) {
    console.error("Yapily connect failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Yapily connect failed" },
      { status: 500 }
    );
  }
}
