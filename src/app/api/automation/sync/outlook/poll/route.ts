/**
 * GET /api/automation/sync/outlook/poll
 *
 * Long-running endpoint that triggers Outlook sync every 10 minutes.
 * Open this in a browser tab or call via cron to keep emails flowing.
 * Returns immediately after triggering the first sync.
 */
export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin;

  // Trigger immediate sync
  try {
    const res = await fetch(`${baseUrl}/api/automation/sync/outlook`, { method: "POST" });
    const data = await res.json();
    return Response.json({
      message: "Sync triggered. Set up a cron job or use the /schedule skill to run every 10 minutes.",
      syncResult: data,
      cronEndpoint: `${baseUrl}/api/automation/sync/outlook`,
      cronMethod: "POST",
      suggestedInterval: "*/10 * * * *",
    });
  } catch (error) {
    return Response.json({ error: "Sync trigger failed" }, { status: 500 });
  }
}
