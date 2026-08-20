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

type PageCtx = { has_more_page?: boolean; page?: number; per_page?: number; total?: number };

export async function listBills(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ bills: Array<Record<string, unknown>>; page_context: PageCtx }>("/bills", query);
  return r;
}

export async function getBill(billId: string) {
  const r = await call<{ bill: Record<string, unknown> }>(`/bills/${billId}`);
  return r.bill;
}

export async function listInvoices(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ invoices: Array<Record<string, unknown>>; page_context: PageCtx }>("/invoices", query);
  return r;
}

export async function getInvoice(invoiceId: string) {
  const r = await call<{ invoice: Record<string, unknown> }>(`/invoices/${invoiceId}`);
  return r.invoice;
}

export async function listContacts(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ contacts: Array<Record<string, unknown>>; page_context: PageCtx }>("/contacts", query);
  return r;
}

export async function getContact(contactId: string) {
  const r = await call<{ contact: Record<string, unknown> }>(`/contacts/${contactId}`);
  return r.contact;
}

/**
 * Customer payments — money received from customers, applied to invoices.
 */
export async function listCustomerPayments(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ customerpayments: Array<Record<string, unknown>>; page_context: PageCtx }>("/customerpayments", query);
  return r;
}

/**
 * Vendor payments — money paid to suppliers, applied to bills.
 */
export async function listVendorPayments(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ vendorpayments: Array<Record<string, unknown>>; page_context: PageCtx }>("/vendorpayments", query);
  return r;
}

export async function listChartOfAccounts(query: Record<string, string | number | undefined> = {}) {
  const r = await call<{ chartofaccounts: Array<Record<string, unknown>>; page_context: PageCtx }>("/chartofaccounts", query);
  return r;
}

/**
 * Generic paginated puller — yields every page until has_more_page is false.
 * Use for one-shot historical imports.
 */
export async function* paginate<T>(
  fetcher: (page: number) => Promise<{ items: T[]; ctx: PageCtx }>
): AsyncGenerator<T[], void, unknown> {
  let page = 1;
  while (true) {
    const { items, ctx } = await fetcher(page);
    if (items.length > 0) yield items;
    if (!ctx.has_more_page) break;
    page++;
  }
}
