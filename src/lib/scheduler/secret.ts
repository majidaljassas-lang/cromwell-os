/**
 * Guard for /api/automation/* and /api/scheduler/*. Every automation
 * endpoint that does not require a user session must call this at the
 * top of each HTTP handler.
 *
 * Returns:
 *   - Response(500) if SCHEDULER_SECRET is not configured
 *   - Response(401) if the header is missing or mismatched
 *   - null if the caller is authenticated
 */
export function checkSchedulerSecret(request: Request): Response | null {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) {
    return Response.json(
      { error: "SCHEDULER_SECRET not configured on the server" },
      { status: 500 }
    );
  }
  const provided = request.headers.get("x-scheduler-secret");
  if (!provided || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Outbound header block for internal callers that fetch
 * /api/automation/* or /api/scheduler/* over HTTP. Returns an empty
 * object when SCHEDULER_SECRET is unset so local smoke tests still work
 * against unguarded endpoints during bring-up.
 */
export function schedulerSecretHeaders(): Record<string, string> {
  const secret = process.env.SCHEDULER_SECRET;
  return secret ? { "x-scheduler-secret": secret } : {};
}
