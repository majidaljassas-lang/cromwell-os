// ---------------------------------------------------------------------------
// Yapily Open Banking API Client
// https://docs.yapily.com/
// ---------------------------------------------------------------------------

const YAPILY_BASE_URL = "https://api.yapily.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Institution {
  id: string;
  name: string;
  fullName: string;
  countries: Array<{ displayName: string; countryCode2: string }>;
  media: Array<{ type: string; source: string }>;
}

export interface ConsentResponse {
  id: string;
  institutionId: string;
  status: string;
  authorisationUrl: string;
  qrCodeUrl?: string;
  createdAt: string;
}

export interface YapilyAccount {
  id: string;
  type: string;
  description: string;
  balance: number;
  currency: string;
  accountNames: Array<{ name: string }>;
  accountIdentifications: Array<{
    type: string;
    identification: string;
  }>;
}

export interface YapilyTransaction {
  id: string;
  date: string;
  bookingDateTime: string;
  amount: number;
  currency: string;
  transactionAmount: { amount: number; currency: string };
  description: string;
  reference: string;
  status: string;
  transactionInformation: string[];
  balance: { balanceAmount: { amount: number; currency: string } };
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const uuid = process.env.YAPILY_APP_UUID;
  const secret = process.env.YAPILY_APP_SECRET;

  if (!uuid || !secret) {
    throw new Error("Yapily credentials not configured. Set YAPILY_APP_UUID and YAPILY_APP_SECRET.");
  }

  const encoded = Buffer.from(`${uuid}:${secret}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
  };
}

/** Check if Yapily is configured */
export function isYapilyConfigured(): boolean {
  return !!(process.env.YAPILY_APP_UUID && process.env.YAPILY_APP_SECRET);
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Get supported institutions (banks) */
export async function getInstitutions(): Promise<Institution[]> {
  const res = await fetch(`${YAPILY_BASE_URL}/institutions`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yapily getInstitutions failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data || [];
}

/** Create an account authorization consent */
export async function createConsent(
  institutionId: string,
  callbackUrl: string
): Promise<ConsentResponse> {
  const res = await fetch(`${YAPILY_BASE_URL}/account-auth-requests`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      applicationUserId: "cromwell-os-user",
      institutionId,
      callback: callbackUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yapily createConsent failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    id: data.data?.id || data.id,
    institutionId,
    status: data.data?.status || "AWAITING_AUTHORIZATION",
    authorisationUrl: data.data?.authorisationUrl || data.data?.authorizationUrl || "",
    qrCodeUrl: data.data?.qrCodeUrl,
    createdAt: data.data?.createdAt || new Date().toISOString(),
  };
}

/** Get accounts for a given consent token */
export async function getAccounts(consentToken: string): Promise<YapilyAccount[]> {
  const res = await fetch(`${YAPILY_BASE_URL}/accounts`, {
    method: "GET",
    headers: {
      ...getAuthHeaders(),
      consent: consentToken,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yapily getAccounts failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data || [];
}

/** Get transactions for an account */
export async function getTransactions(
  consentToken: string,
  accountId: string,
  from?: string
): Promise<YapilyTransaction[]> {
  const url = new URL(`${YAPILY_BASE_URL}/accounts/${accountId}/transactions`);
  if (from) {
    url.searchParams.set("from", from);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      ...getAuthHeaders(),
      consent: consentToken,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yapily getTransactions failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data || [];
}
