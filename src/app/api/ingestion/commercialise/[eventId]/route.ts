import { commercialiseZohoBill, commercialiseMessage } from "@/lib/ingestion/commercialiser";

/**
 * Commercialise an ingestion event into the commercial spine.
 * POST body determines the action type.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const body = await request.json();
    const { action } = body as { action: string };

    if (action === "zoho_bill") {
      const { supplierId, siteId, customerId, ticketId, actor } = body;
      if (!supplierId) {
        return Response.json({ error: "supplierId required for zoho_bill" }, { status: 400 });
      }
      const result = await commercialiseZohoBill(eventId, {
        supplierId,
        siteId,
        customerId,
        ticketId,
        actor,
      });
      return Response.json(result, { status: result.success ? 201 : 422 });
    }

    if (action === "message") {
      const {
        createEnquiry, createEvidence, ticketId, ticketLineId,
        sourceContactId, suggestedSiteId, suggestedCustomerId,
        enquiryType, evidenceType, actor,
      } = body;

      const result = await commercialiseMessage(eventId, {
        createEnquiry,
        createEvidence,
        ticketId,
        ticketLineId,
        sourceContactId,
        suggestedSiteId,
        suggestedCustomerId,
        enquiryType,
        evidenceType,
        actor,
      });
      return Response.json(result, { status: result.success ? 201 : 422 });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("Commercialisation failed:", error);
    return Response.json({ error: "Commercialisation failed" }, { status: 500 });
  }
}
