// Plaid AIS client (Account Information Services / Transactions product only).
// Docs: https://plaid.com/docs/
//
// Tokens:
//   - link_token: short-lived (4h), minted server-side, used by Plaid Link in browser.
//   - public_token: returned by Link on success, exchanged once for an access_token.
//   - access_token: long-lived, never expires on its own; revoked when user reauths or item closes.
//   - 90-day SCA consent expiry is mandated by UK PSD2 — Plaid will return ITEM_LOGIN_REQUIRED
//     and we must walk the user through Link in update mode to re-consent.

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type LinkTokenCreateRequest,
} from "plaid";

const ENV = (process.env.PLAID_ENV || "sandbox") as keyof typeof PlaidEnvironments;
const CLIENT_ID = process.env.PLAID_CLIENT_ID;
const SECRET =
  ENV === "production"
    ? process.env.PLAID_SECRET_PRODUCTION
    : ENV === "development"
      ? process.env.PLAID_SECRET_DEVELOPMENT
      : process.env.PLAID_SECRET_SANDBOX;

export function isConfigured(): boolean {
  return !!(CLIENT_ID && SECRET);
}

export function getEnv(): string {
  return String(ENV);
}

let _client: PlaidApi | null = null;
export function getPlaidClient(): PlaidApi {
  if (!CLIENT_ID || !SECRET) {
    throw new Error("Plaid credentials missing — set PLAID_CLIENT_ID and PLAID_SECRET_SANDBOX");
  }
  if (_client) return _client;
  const config = new Configuration({
    basePath: PlaidEnvironments[ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": CLIENT_ID,
        "PLAID-SECRET": SECRET,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

// Mint a link_token. The returned token is what the browser hands to Plaid Link.
// `userId` should be a stable per-installation id; Plaid uses it to dedupe Items.
// `webhookUrl` optional — only set in production where the URL is publicly reachable.
export async function createLinkToken(opts: {
  userId: string;
  webhookUrl?: string;
}): Promise<string> {
  const client = getPlaidClient();
  const body: LinkTokenCreateRequest = {
    user: { client_user_id: opts.userId },
    client_name: "Cromwell OS",
    products: [Products.Transactions],
    country_codes: [CountryCode.Gb],
    language: "en",
    ...(opts.webhookUrl ? { webhook: opts.webhookUrl } : {}),
  };
  const res = await client.linkTokenCreate(body);
  return res.data.link_token;
}

// Exchange a public_token (from Link onSuccess) for a long-lived access_token + item_id.
export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const client = getPlaidClient();
  const res = await client.itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: res.data.access_token, itemId: res.data.item_id };
}

// Fetch the institution metadata for a given item — used to populate displayName/providerName.
export async function getItemInstitution(accessToken: string): Promise<{
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  consentExpirationTime: Date | null;
}> {
  const client = getPlaidClient();
  const item = await client.itemGet({ access_token: accessToken });
  const institutionId = item.data.item.institution_id ?? null;
  let institutionName: string | null = null;
  if (institutionId) {
    const inst = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Gb],
    });
    institutionName = inst.data.institution.name;
  }
  const consentExp = item.data.item.consent_expiration_time;
  return {
    itemId: item.data.item.item_id,
    institutionId,
    institutionName,
    consentExpirationTime: consentExp ? new Date(consentExp) : null,
  };
}

// Fetch all accounts for an item with current balances.
export async function getAccounts(accessToken: string) {
  const client = getPlaidClient();
  const res = await client.accountsGet({ access_token: accessToken });
  return res.data.accounts;
}

// Cursor-based transaction sync. Returns added/modified/removed + next cursor.
// Pass cursor=null on first call. Loop while has_more.
export async function syncTransactions(
  accessToken: string,
  cursor: string | null,
) {
  const client = getPlaidClient();
  const res = await client.transactionsSync({
    access_token: accessToken,
    cursor: cursor ?? undefined,
  });
  return res.data;
}

// Mint a link_token in update mode for re-authentication after consent expires
// or when ITEM_LOGIN_REQUIRED webhook fires.
export async function createUpdateLinkToken(opts: {
  userId: string;
  accessToken: string;
  webhookUrl?: string;
}): Promise<string> {
  const client = getPlaidClient();
  const body: LinkTokenCreateRequest = {
    user: { client_user_id: opts.userId },
    client_name: "Cromwell OS",
    country_codes: [CountryCode.Gb],
    language: "en",
    access_token: opts.accessToken,
    ...(opts.webhookUrl ? { webhook: opts.webhookUrl } : {}),
  };
  const res = await client.linkTokenCreate(body);
  return res.data.link_token;
}
