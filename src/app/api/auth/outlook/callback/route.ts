import { prisma } from "@/lib/prisma";
import { exchangeCodeForTokens, fetchUserProfile } from "@/lib/microsoft/graph-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error} — ${searchParams.get("error_description")}`, { status: 400 });
  }

  if (!code) {
    return new Response("No authorization code received", { status: 400 });
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Get user profile
    const profile = await fetchUserProfile(tokens.access_token);

    // Store as IngestionSource
    const existing = await prisma.ingestionSource.findFirst({
      where: { sourceType: "OUTLOOK", externalRef: profile.mail || profile.userPrincipalName },
    });

    if (existing) {
      await prisma.ingestionSource.update({
        where: { id: existing.id },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          status: "ACTIVE",
          displayName: profile.displayName,
        },
      });
    } else {
      await prisma.ingestionSource.create({
        data: {
          sourceType: "OUTLOOK",
          externalRef: profile.mail || profile.userPrincipalName,
          displayName: profile.displayName || profile.mail,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          status: "ACTIVE",
        },
      });
    }

    // Redirect to ingestion page
    return Response.redirect(new URL("/ingestion?connected=outlook", request.url).toString());
  } catch (err) {
    console.error("Outlook OAuth callback failed:", err);
    return new Response(`OAuth failed: ${err instanceof Error ? err.message : "unknown"}`, { status: 500 });
  }
}
