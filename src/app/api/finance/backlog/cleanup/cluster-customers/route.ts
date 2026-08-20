/**
 * Cluster Zoho customers as OS subsidiaries under a single parent.
 *
 * For each zohoCustomerId in the request, we:
 *   1. Create a new OS Customer with the Zoho customer name (and original
 *      Zoho name as a CustomerAlias).
 *   2. Set parentCustomerEntityId on the new child to the chosen parent.
 *   3. Create a ZohoCustomerLink pointing the Zoho id → new child OS Customer.
 *
 * The parent OS Customer is either picked (existing) or created inline.
 * Underlying Zoho data is never modified.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Body {
  zohoCustomerIds: string[];
  parentCustomerId?: string;
  newParentName?: string;
  isBillingEntityForChildren?: boolean;
  notes?: string;
  linkedBy?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const ids = [...new Set((body.zohoCustomerIds || []).filter(Boolean))];
    if (ids.length === 0) {
      return NextResponse.json({ error: "zohoCustomerIds required" }, { status: 400 });
    }
    if (!body.parentCustomerId && !body.newParentName?.trim()) {
      return NextResponse.json(
        { error: "parentCustomerId or newParentName required" },
        { status: 400 }
      );
    }

    // Pull Zoho names so we can use them as the new child names.
    const meta = await prisma.zohoImportedInvoice.findMany({
      where: { zohoCustomerId: { in: ids } },
      select: { zohoCustomerId: true, customerName: true },
      distinct: ["zohoCustomerId"],
    });
    const nameById = new Map(meta.map((m) => [m.zohoCustomerId!, m.customerName ?? ""]));
    for (const id of ids) {
      if (!nameById.get(id)?.trim()) {
        return NextResponse.json(
          { error: `Zoho customer name missing for id ${id} — cannot create subsidiary` },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Resolve or create the parent.
      let parent;
      if (body.parentCustomerId) {
        parent = await tx.customer.findUnique({
          where: { id: body.parentCustomerId },
          select: { id: true, name: true, isBillingEntity: true },
        });
        if (!parent) throw new Error("Parent customer not found");
      } else {
        parent = await tx.customer.create({
          data: {
            name: body.newParentName!.trim(),
            isBillingEntity: false,
            entityType: "GROUP_PARENT",
            notes: body.notes ?? "Created from Zoho cleanup workspace as group parent",
          },
          select: { id: true, name: true, isBillingEntity: true },
        });
      }

      // 2. Create one OS Customer per Zoho id, under the parent.
      const createdChildren: Array<{ id: string; name: string; zohoCustomerId: string }> = [];
      const linksCreated: string[] = [];

      for (const zohoCustomerId of ids) {
        const zohoName = nameById.get(zohoCustomerId)!.trim();

        // Skip if this Zoho id is already linked.
        const existingLink = await tx.zohoCustomerLink.findUnique({
          where: { zohoCustomerId },
        });
        if (existingLink) {
          // Re-point to a new child? Safer: leave as-is, return info.
          continue;
        }

        const child = await tx.customer.create({
          data: {
            name: zohoName,
            parentCustomerEntityId: parent.id,
            entityType: "SUBSIDIARY",
            isBillingEntity: true,
            notes: `Subsidiary created from Zoho cleanup (parent: ${parent.name})`,
          },
          select: { id: true, name: true },
        });

        // Save the original Zoho name as an alias for future fuzzy matching.
        await tx.customerAlias.upsert({
          where: { customerId_aliasText: { customerId: child.id, aliasText: zohoName } },
          create: {
            customerId: child.id,
            aliasText: zohoName,
            aliasSource: "ZOHO_CLEANUP",
            manualConfirmed: true,
            confidenceScore: 1,
          },
          update: {},
        });

        await tx.zohoCustomerLink.create({
          data: {
            zohoCustomerId,
            zohoCustomerName: zohoName,
            customerId: child.id,
            manualConfirmed: true,
            notes: body.notes,
            linkedBy: body.linkedBy,
          },
        });

        createdChildren.push({ id: child.id, name: child.name, zohoCustomerId });
        linksCreated.push(zohoCustomerId);
      }

      return { parent, createdChildren, linksCreated, skipped: ids.length - linksCreated.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cluster failed" },
      { status: 500 }
    );
  }
}
