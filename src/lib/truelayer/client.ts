// TrueLayer Data API (AIS) client.
// Docs: https://docs.truelayer.com/docs/data-api-reference
//
// Sandbox auth:    https://auth.truelayer-sandbox.com
// Sandbox API:     https://api.truelayer-sandbox.com
// Live auth:       https://auth.truelayer.com
// Live API:        https://api.truelayer.com
//
// Tokens: access_token expires in ~1 hour; refresh_token good until 90-day SCA.
// After 90 days the user MUST re-consent (FCA-mandated, not optional).

const ENV = process.env.TRUELAYER_ENV === "live" ? "live" : "sandbox";

export const TL_AUTH_BASE =
  ENV === "live" ? "https://auth.truelayer.com" : "https://auth.truelayer-sandbox.com";
export const TL_API_BASE =
  ENV === "live" ? "https://api.truelayer.com" : "https://api.truelayer-sandbox.com";

const CLIENT_ID = process.env.TRUELAYER_CLIENT_ID;
const CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.TRUELAYER_REDIRECT_URI || "http://localhost:3000/api/banking/callback";

const SCOPES =
  "info accounts balance transactions cards direct_debits standing_orders offline_access";

export function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export function getEnv() {
  return ENV;
}

export function getRedirectUri() {
  return REDIRECT_URI;
}

// Build the authorization URL the user is sent to.
// `providers` is a TrueLayer-format list, e.g. "uk-ob-barclays" or
// "uk-ob-barclays uk-ob-barclaycard" (space-separated for multiple choice).
// In sandbox, "uk-cs-mock" gives the mock bank for testing.
export function buildAuthUrl({
  state,
  providers,
}: {
  state: string;
  providers: string;
}): string {
  if (!CLIENT_ID) throw new Error("TRUELAYER_CLIENT_ID not set");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    providers,
    state,
    enable_mock: ENV === "sandbox" ? "true" : "false",
  });
  return `${TL_AUTH_BASE}/?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("TrueLayer credentials missing");
  const res = await fetch(`${TL_AUTH_BASE}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${txt}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("TrueLayer credentials missing");
  const res = await fetch(`${TL_AUTH_BASE}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function api<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${TL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`TrueLayer ${path} ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function getAccounts(accessToken: string) {
  return api<{ results: TLAccount[] }>("/data/v1/accounts", accessToken);
}

export async function getCards(accessToken: string) {
  return api<{ results: TLCard[] }>("/data/v1/cards", accessToken);
}

export async function getAccountBalance(accessToken: string, accountId: string) {
  return api<{ results: TLBalance[] }>(
    `/data/v1/accounts/${accountId}/balance`,
    accessToken,
  );
}

export async function getCardBalance(accessToken: string, cardId: string) {
  return api<{ results: TLCardBalance[] }>(
    `/data/v1/cards/${cardId}/balance`,
    accessToken,
  );
}

export async function getAccountTransactions(
  accessToken: string,
  accountId: string,
  from?: string,
  to?: string,
) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return api<{ results: TLTransaction[] }>(
    `/data/v1/accounts/${accountId}/transactions${qs ? "?" + qs : ""}`,
    accessToken,
  );
}

export async function getCardTransactions(
  accessToken: string,
  cardId: string,
  from?: string,
  to?: string,
) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return api<{ results: TLTransaction[] }>(
    `/data/v1/cards/${cardId}/transactions${qs ? "?" + qs : ""}`,
    accessToken,
  );
}

// ---- TrueLayer Data API v1 response types ----

export interface TLAccount {
  account_id: string;
  account_type: string; // TRANSACTION, SAVINGS
  display_name: string;
  currency: string;
  account_number: {
    iban?: string;
    number?: string;
    sort_code?: string;
    swift_bic?: string;
  };
  provider: { display_name: string; provider_id: string; logo_uri?: string };
  update_timestamp: string;
}

export interface TLCard {
  account_id: string;
  card_network: string;
  card_type: string; // CREDIT, DEBIT
  currency: string;
  display_name: string;
  partial_card_number: string;
  name_on_card?: string;
  valid_from?: string;
  valid_to?: string;
  update_timestamp: string;
  provider: { display_name: string; provider_id: string; logo_uri?: string };
}

export interface TLBalance {
  available: number;
  current: number;
  currency: string;
  overdraft?: number;
  update_timestamp: string;
}

export interface TLCardBalance {
  available: number;
  current: number;
  currency: string;
  credit_limit?: number;
  last_statement_balance?: number;
  last_statement_date?: string;
  payment_due?: number;
  payment_due_date?: string;
  update_timestamp: string;
}

export interface TLTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
  transaction_type: "DEBIT" | "CREDIT";
  transaction_category: string;
  transaction_classification?: string[];
  merchant_name?: string;
  running_balance?: { amount: number; currency: string };
  meta?: Record<string, string>;
}
