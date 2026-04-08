import { getAuthUrl } from "@/lib/microsoft/graph-client";

export async function GET() {
  const url = getAuthUrl();
  return Response.redirect(url);
}
