/**
 * GET /api/enable-banking/aspsps?country=GB
 *
 * Pass-through to Enable's GET /aspsps — lists every bank (ASPSP) available
 * under your app's environment (sandbox returns mock banks; production
 * returns real banks).
 */
import { getAppJwt } from "@/lib/enable-banking/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country");
  const api = process.env.ENABLE_API_BASE ?? "https://api.enablebanking.com";
  const qs = country ? `?country=${encodeURIComponent(country)}` : "";
  const jwt = getAppJwt();
  const r = await fetch(`${api}/aspsps${qs}`, { headers: { Authorization: `Bearer ${jwt}` } });
  const body = await r.text();
  return new Response(body, { status: r.status, headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" } });
}
