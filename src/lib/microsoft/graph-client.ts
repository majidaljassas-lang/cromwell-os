/**
 * Microsoft Graph API client for Outlook email access.
 * Uses OAuth2 Authorization Code flow with refresh tokens.
 */

const TENANT_ID = process.env.OUTLOOK_TENANT_ID!;
const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID!;
const CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET!;
const REDIRECT_URI = process.env.OUTLOOK_REDIRECT_URI || "http://localhost:3000/api/auth/outlook/callback";

const AUTH_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;
const GRAPH_URL = "https://graph.microsoft.com/v1.0";
const SCOPES = "openid profile email offline_access Mail.Read Mail.ReadWrite User.Read";

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_mode: "query",
    state: state || "outlook-connect",
  });
  return `${AUTH_URL}/authorize?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(`${AUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      scope: SCOPES,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(`${AUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

export async function graphGet(accessToken: string, path: string) {
  const res = await fetch(`${GRAPH_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error (${res.status}): ${err}`);
  }
  return res.json();
}

export async function fetchEmails(
  accessToken: string,
  opts: { folder?: string; since?: string; top?: number } = {}
) {
  const { folder = "inbox", since, top = 50 } = opts;
  let path = `/me/mailFolders/${folder}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments,conversationId,internetMessageId`;
  if (since) {
    path += `&$filter=receivedDateTime ge ${since}`;
  }
  return graphGet(accessToken, path) as Promise<{
    value: Array<{
      id: string;
      subject: string;
      from: { emailAddress: { name: string; address: string } };
      toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
      ccRecipients: Array<{ emailAddress: { name: string; address: string } }>;
      receivedDateTime: string;
      body: { contentType: string; content: string };
      bodyPreview: string;
      hasAttachments: boolean;
      conversationId: string;
      internetMessageId: string;
    }>;
    "@odata.nextLink"?: string;
  }>;
}

export async function fetchAttachments(
  accessToken: string,
  messageId: string
) {
  return graphGet(accessToken, `/me/messages/${messageId}/attachments`) as Promise<{
    value: Array<{
      id: string;
      name: string;
      contentType: string;
      size: number;
      isInline: boolean;
      contentBytes?: string; // base64
    }>;
  }>;
}

export async function fetchUserProfile(accessToken: string) {
  return graphGet(accessToken, "/me") as Promise<{
    displayName: string;
    mail: string;
    userPrincipalName: string;
  }>;
}
