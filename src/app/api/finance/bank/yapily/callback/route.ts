import { prisma } from "@/lib/prisma";
import { getAccounts, isYapilyConfigured } from "@/lib/finance/yapily";

function redirectTo(path: string, request: Request): Response {
  const origin = new URL(request.url).origin;
  return Response.redirect(`${origin}${path}`, 302);
}

export async function GET(request: Request) {
  try {
    if (!isYapilyConfigured()) {
      return Response.json(
        { error: "Yapily is not configured" },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const consentToken = searchParams.get("consent") || searchParams.get("consent-token");
    const error = searchParams.get("error");

    if (error) {
      console.error("Yapily authorization error:", error);
      return redirectTo("/finance?yapily_error=" + encodeURIComponent(error), request);
    }

    if (!consentToken) {
      return Response.json(
        { error: "No consent token received" },
        { status: 400 }
      );
    }

    // Fetch accounts from Yapily
    const yapilyAccounts = await getAccounts(consentToken);

    if (yapilyAccounts.length === 0) {
      return redirectTo("/finance?yapily_error=no_accounts", request);
    }

    // Get the pending bank account ID (if we stored one during connect)
    const pendingBankAccountSetting = await prisma.systemSetting.findUnique({
      where: { key: "yapily_pending_bank_account_id" },
    });

    for (const yapilyAccount of yapilyAccounts) {
      // Extract sort code and account number from identifications
      let sortCode = "";
      let accountNumber = "";
      for (const ident of yapilyAccount.accountIdentifications || []) {
        if (ident.type === "SORT_CODE") sortCode = ident.identification;
        if (ident.type === "ACCOUNT_NUMBER") accountNumber = ident.identification;
      }

      // Try to match to existing bank account by account number + sort code
      let bankAccount = null;

      if (pendingBankAccountSetting?.value) {
        bankAccount = await prisma.bankAccount.findUnique({
          where: { id: pendingBankAccountSetting.value },
        });
      }

      if (!bankAccount && accountNumber) {
        bankAccount = await prisma.bankAccount.findFirst({
          where: {
            accountNumber: { contains: accountNumber },
            isActive: true,
          },
        });
      }

      if (bankAccount) {
        // Update existing bank account with Yapily details
        await prisma.bankAccount.update({
          where: { id: bankAccount.id },
          data: {
            yapilyConsentToken: consentToken,
            yapilyAccountId: yapilyAccount.id,
            currentBalance: yapilyAccount.balance || bankAccount.currentBalance,
          },
        });
      }
      // If no matching bank account found, we skip creating one
      // (bank accounts in this system are linked to chart of accounts, so they need to be set up properly)
    }

    // Clean up pending settings
    await prisma.systemSetting.deleteMany({
      where: {
        key: {
          in: ["yapily_pending_consent_id", "yapily_pending_bank_account_id"],
        },
      },
    });

    return redirectTo("/finance?yapily_connected=true", request);
  } catch (error) {
    console.error("Yapily callback failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Yapily callback failed" },
      { status: 500 }
    );
  }
}
