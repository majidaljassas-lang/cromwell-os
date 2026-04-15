/**
 * Enable Banking direct REST API client.
 *
 * ─── Auth flow (verified from Enable Banking developer docs) ───────────────
 *
 * Enable Banking is a PSD2/Open-Banking aggregator. It does NOT use a
 * traditional OAuth2 client-credentials grant to access the API itself.
 * Instead, the integration works in two distinct layers:
 *
 * 1. APPLICATION AUTHENTICATION (server → Enable API)
 *    Every request to api.enablebanking.com must carry a signed JWT in the
 *    Authorization header:
 *      Authorization: Bearer <JWT>
 *    The JWT is RS256-signed with the private key you registered in the
 *    Enable Banking developer portal (kid = ENABLE_JWT_KID).
 *    Fields:  { iss: ENABLE_APP_ID, aud: "api.enablebanking.com", iat, exp }
 *    Tokens are short-lived (typically 300 s). We cache in-process and
 *    re-sign 60 s before expiry.
 *
 * 2. USER (PSU) CONSENT SESSION
 *    To read an actual bank account (Barclays Business / Barclaycard), you
 *    first POST /sessions to obtain a redirectUrl. The user follows that URL
 *    to their bank's SCA page, then is redirected back to your callbackUrl.
 *    Enable appends ?code=<auth_code>&state=<state> to the callbackUrl.
 *    You then POST /sessions/{sessionId} with the auth_code to activate the
 *    session. The sessionId (returned in the first POST) is the long-lived
 *    handle. Sessions last ~90 days (bank-dependent); when expired Enable
 *    returns HTTP 401 on account/transaction calls.
 *
 * Environment variables:
 *   ENABLE_APP_ID          – Application ID from the portal (e.g. "my-app-uuid")
 *   ENABLE_JWT_KID         – Key ID registered in the portal
 *   ENABLE_JWT_PRIVATE_KEY – RSA private key PEM (newlines as \n or multiline)
 *   ENABLE_API_BASE        – Default: https://api.enablebanking.com
 *   NEXTAUTH_URL / NEXT_PUBLIC_APP_URL – used to build the callbackUrl
 *
 * Reference:
 *   https://enablebanking.com/docs/api/reference/
 *   https://enablebanking.com/docs/quickstart/
 */

import crypto from "crypto";

// ─── Config ────────────────────────────────────────────────────────────────

const API_BASE = process.env.ENABLE_API_BASE ?? "https://api.enablebanking.com";
const APP_ID = process.env.ENABLE_APP_ID ?? "";
const JWT_KID = process.env.ENABLE_JWT_KID ?? "";
/** Accept both escaped \n (from .env.local) and literal newlines */
const JWT_PRIVATE_KEY = (process.env.ENABLE_JWT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

// ─── JWT signing ───────────────────────────────────────────────────────────

let _cachedJwt: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(): string {
  if (!APP_ID || !JWT_KID || !JWT_PRIVATE_KEY) {
    throw new Error(
      "Enable Banking not configured. Set ENABLE_APP_ID, ENABLE_JWT_KID, ENABLE_JWT_PRIVATE_KEY in .env.local"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 300; // 5-minute token

  const header = base64url(JSON.stringify({ alg: "RS256", kid: JWT_KID, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: APP_ID, aud: "api.enablebanking.com", iat: now, exp })
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto.createSign("SHA256").update(signingInput).sign(JWT_PRIVATE_KEY);
  return `${signingInput}.${base64url(sig)}`;
}

export function getAppJwt(): string {
  if (_cachedJwt && _cachedJwt.expiresAt > Date.now() + 60_000) return _cachedJwt.token;
  const token = signJwt();
  _cachedJwt = { token, expiresAt: Date.now() + 240_000 }; // cache 4 min (token valid 5 min)
  return token;
}

// ─── Typed shapes ──────────────────────────────────────────────────────────

export interface EnableSession {
  session_id: string;
  /** PSU redirect URL — send the user here to complete SCA at their bank */
  url: string;
}

export interface EnableAccount {
  uid: string;           // Enable's internal account UID (use as externalRef / enableAccountId)
  resource_id: string;   // Bank's own account ID
  name: string;
  product: string | null;
  currency: string;
  bban: string | null;   // Basic bank account number (sort-code + account)
  iban: string | null;
  details: string | null;
  status: string | null;
}

export interface EnableBalance {
  balance_amount: { amount: string; currency: string };
  balance_type: string;  // "closingBooked" | "interimAvailable" etc.
  last_change_date_time: string | null;
}

export interface EnableTransaction {
  transaction_id: string;
  entry_reference: string | null;
  booking_date: string | null;          // ISO date YYYY-MM-DD
  value_date: string | null;
  transaction_amount: { amount: string; currency: string };
  creditor_name: string | null;
  debtor_name: string | null;
  remittance_information_unstructured: string | null;
  proprietary_bank_transaction_code: string | null;
  balance_after_transaction: { balance_amount: { amount: string } } | null;
}

export interface EnableTransactionsResponse {
  transactions: {
    booked: EnableTransaction[];
    pending?: EnableTransaction[];
  };
  continuation_key?: string; // pagination cursor
}

// ─── Internal fetch helper ─────────────────────────────────────────────────

async function enableFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAppJwt();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Enable Banking ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Session management ────────────────────────────────────────────────────

/**
 * Step 1 of consent: POST /auth
 * Returns an authorization URL to redirect the user to AND an authorization_id.
 * The authorization_id should be used as the OAuth "state" so we can cross-check on callback.
 *
 * @param callbackUrl  - Your application's redirect URI after SCA
 * @param aspspCountry - ISO 3166-1 alpha-2, e.g. "GB"
 * @param aspspName    - Enable's ASPSP name, e.g. "Barclays Business" or "Barclaycard"
 * @param state        - Arbitrary string Enable will echo back on redirect
 */
export async function startAuthorization(
  callbackUrl: string,
  aspspCountry: string,
  aspspName: string,
  state: string,
): Promise<{ url: string; authorization_id: string; psu_id_hash?: string }> {
  return enableFetch<{ url: string; authorization_id: string; psu_id_hash?: string }>("/auth", {
    method: "POST",
    body: JSON.stringify({
      access: {
        // Full ISO 8601 with timezone — Enable rejects date-only strings ("no timezone provided")
        valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      aspsp: {
        name: aspspName,
        country: aspspCountry,
      },
      redirect_url: callbackUrl,
      psu_type: "business",
      state,
    }),
  });
}

/**
 * Step 2 of consent: POST /sessions  (NOT PATCH)
 * Called from the OAuth callback once the bank has redirected back with ?code=...
 * Returns the persistent session_id + accessible accounts list.
 */
export async function createSession(
  authCode: string,
): Promise<EnableSession> {
  return enableFetch<EnableSession>("/sessions", {
    method: "POST",
    body: JSON.stringify({ code: authCode }),
  });
}

/** @deprecated use createSession(authCode) — kept as alias while callers migrate. */
export async function activateSession(_sessionId: string, authCode: string): Promise<EnableSession> {
  return createSession(authCode);
}

// ─── Accounts ──────────────────────────────────────────────────────────────

/** GET /sessions/{sessionId}/accounts */
export async function listAccounts(sessionId: string): Promise<EnableAccount[]> {
  const res = await enableFetch<{ accounts: EnableAccount[] }>(
    `/sessions/${sessionId}/accounts`
  );
  return res.accounts ?? [];
}

// ─── Balances ──────────────────────────────────────────────────────────────

/** GET /sessions/{sessionId}/accounts/{accountId}/balances */
export async function getBalance(
  sessionId: string,
  accountId: string
): Promise<EnableBalance[]> {
  const res = await enableFetch<{ balances: EnableBalance[] }>(
    `/sessions/${sessionId}/accounts/${accountId}/balances`
  );
  return res.balances ?? [];
}

/** Pick the most useful balance figure from the array Enable returns */
export function pickBalance(balances: EnableBalance[]): number {
  // Prefer interimAvailable → closingBooked → first entry
  const preferred = ["interimAvailable", "closingBooked"];
  for (const type of preferred) {
    const b = balances.find((x) => x.balance_type === type);
    if (b) return parseFloat(b.balance_amount.amount);
  }
  return balances.length > 0 ? parseFloat(balances[0].balance_amount.amount) : 0;
}

// ─── Transactions ──────────────────────────────────────────────────────────

/**
 * GET /sessions/{sessionId}/accounts/{accountId}/transactions
 * Pages through all transactions using continuation_key.
 *
 * @param fromDate ISO date YYYY-MM-DD
 * @param toDate   ISO date YYYY-MM-DD (defaults to today)
 */
export async function listTransactions(
  sessionId: string,
  accountId: string,
  {
    fromDate,
    toDate,
    continuationKey,
  }: { fromDate: string; toDate?: string; continuationKey?: string }
): Promise<EnableTransactionsResponse> {
  const qs = new URLSearchParams({ date_from: fromDate });
  if (toDate) qs.set("date_to", toDate);
  if (continuationKey) qs.set("continuation_key", continuationKey);
  return enableFetch<EnableTransactionsResponse>(
    `/sessions/${sessionId}/accounts/${accountId}/transactions?${qs.toString()}`
  );
}

/** Fetch ALL pages, returns flat booked+pending array */
export async function listAllTransactions(
  sessionId: string,
  accountId: string,
  opts: { fromDate: string; toDate?: string }
): Promise<EnableTransaction[]> {
  const all: EnableTransaction[] = [];
  let cursor: string | undefined;
  do {
    const page = await listTransactions(sessionId, accountId, { ...opts, continuationKey: cursor });
    all.push(...(page.transactions?.booked ?? []), ...(page.transactions?.pending ?? []));
    cursor = page.continuation_key;
  } while (cursor);
  return all;
}
