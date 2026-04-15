/**
 * Zoho Books direct REST API client.
 * Replaces MCP-based ingestion (per memory: feedback_zoho_direct_api).
 *
 * Auth: refresh-token grant. Access tokens cached in-memory for 55 min.
 */

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.com";
const API      = process.env.ZOHO_API_DOMAIN      || "https://www.zohoapis.com";
const ORG_ID   = process.env.ZOHO_ORG_ID;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body: params });
  if (!res.ok) throw new Error(`Zoho token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in * 1000) };
  return cachedToken.token;
}

async function call<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ organization_id: ORG_ID! });
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const url = `${API}/books/v3${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) throw new Error(`Zoho ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Public ----------------------------------------------------------------

export async function listBills(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ bills: Array<Record<string, unknown>>; page_context: Record<string, unknown> }>("/bills", query);
  return r;
}

export async function getBill(billId: string) {
  const r = await call<{ bill: Record<string, unknown> }>(`/bills/${billId}`);
  return r.bill;
}
