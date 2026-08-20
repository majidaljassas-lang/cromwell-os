import { prisma } from "@/lib/prisma";

const VALID_UOMS = ["EA", "M", "LENGTH", "PACK", "LOT", "SET", "TONNE"] as const;
type Uom = (typeof VALID_UOMS)[number];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const body = await request.json();
    const {
      childLineIds,
      productCode,
      description,
      qty,
      unit,
      expectedCostUnit,
    } = body as {
      childLineIds?: string[];
      productCode?: string;
      description?: string;
      qty?: number | string;
      unit?: string;
      expectedCostUnit?: number | string;
    };

    if (!Array.isArray(childLineIds) || childLineIds.length < 2) {
      return Response.json(
        { error: "Select at least 2 lines to combine" },
        { status: 400 }
      );
    }
    if (!description || !String(description).trim()) {
      return Response.json(
        { error: "Parent description is required" },
        { status: 400 }
      );
    }

    const numQty = Number(qty || 1);
    if (!isFinite(numQty) || numQty <= 0) {
      return Response.json({ error: "Parent qty must be > 0" }, { status: 400 });
    }
    const numCostUnit = Number(expectedCostUnit || 0);
    if (!isFinite(numCostUnit) || numCostUnit < 0) {
      return Response.json(
        { error: "Parent unit cost must be ≥ 0" },
        { status: 400 }
      );
    }

    const resolvedUnit: Uom =
      unit && (VALID_UOMS as readonly string[]).includes(unit)
        ? (unit as Uom)
        : "EA";

    const children = await prisma.ticketLine.findMany({
      where: { id: { in: childLineIds } },
      select: {
        id: true,
        ticketId: true,
        lineType: true,
        payingCustomerId: true,
        siteId: true,
        siteCommercialLinkId: true,
        sectionLabel: true,
        parentLineId: true,
        isBomParent: true,
        canonicalProductId: true,
        createdAt: true,
      },
    });

    if (children.length !== childLineIds.length) {
      return Response.json(
        { error: "One or more selected lines could not be found" },
        { status: 404 }
      );
    }
    for (const c of children) {
      if (c.ticketId !== ticketId) {
        return Response.json(
          { error: "All selected lines must belong to this ticket" },
          { status: 400 }
        );
      }
      if (c.parentLineId) {
        return Response.json(
          { error: "Selection includes a line that is already a BOM component" },
          { status: 400 }
        );
      }
      if (c.isBomParent) {
        return Response.json(
          { error: "Selection includes a line that is already a BOM parent" },
          { status: 400 }
        );
      }
    }

    const seed = children[0];
    const earliestChildCreatedAt = children.reduce(
      (min, c) => (c.createdAt < min ? c.createdAt : min),
      children[0].createdAt,
    );

    const result = await prisma.$transaction(async (tx) => {
      const parent = await tx.ticketLine.create({
        data: {
          ticketId,
          lineType: seed.lineType,
          description: String(description).trim(),
          productCode: productCode?.trim() || null,
          qty: numQty,
          unit: resolvedUnit,
          payingCustomerId: seed.payingCustomerId,
          siteId: seed.siteId,
          siteCommercialLinkId: seed.siteCommercialLinkId,
          sectionLabel: seed.sectionLabel,
          isBomParent: true,
          status: numCostUnit > 0 ? "PRICED" : "CAPTURED",
          expectedCostUnit: numCostUnit > 0 ? numCostUnit : null,
          expectedCostTotal: numCostUnit > 0 ? numCostUnit * numQty : null,
          createdAt: earliestChildCreatedAt,
        },
      });

      await tx.ticketLine.updateMany({
        where: { id: { in: childLineIds } },
        data: { parentLineId: parent.id },
      });

      return tx.ticketLine.findUnique({
        where: { id: parent.id },
        include: { components: { orderBy: { createdAt: "asc" } } },
      });
    });

    // Cascade: if every child has a canonicalProductId, find other untouched
    // sibling lines on this ticket sharing those canonicals and combine them
    // into matching BOM parents (one cascade parent per N-tuple of siblings).
    const cascadeSummary = { cascadedParents: 0, skippedReason: null as string | null };
    const everyChildHasCanonical = children.every((c) => c.canonicalProductId);
    if (everyChildHasCanonical) {
      const canonicalIds = children.map((c) => c.canonicalProductId as string);
      const distinctCanonicals = new Set(canonicalIds);
      if (distinctCanonicals.size !== canonicalIds.length) {
        cascadeSummary.skippedReason =
          "Children share a canonicalProductId — cascade requires distinct canonicals per slot";
      } else {
        const consumedIds = new Set(childLineIds);

        // Build sibling pool per canonical, bucketed by sectionLabel.
        // Cascade only fires within a single section — a CROSSBOX in Flat 3
        // can only pair with a Trim that's also in Flat 3.
        type Sibling = { id: string; createdAt: Date; sectionLabel: string | null };
        const poolByCanonByLabel = new Map<string, Map<string, Sibling[]>>();
        for (const canonId of canonicalIds) {
          const siblings = await prisma.ticketLine.findMany({
            where: {
              ticketId,
              canonicalProductId: canonId,
              parentLineId: null,
              isBomParent: false,
              id: { notIn: [...consumedIds] },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, createdAt: true, sectionLabel: true },
          });
          const byLabel = new Map<string, Sibling[]>();
          for (const s of siblings) {
            const key = s.sectionLabel ?? "__NULL__";
            if (!byLabel.has(key)) byLabel.set(key, []);
            byLabel.get(key)!.push(s);
          }
          poolByCanonByLabel.set(canonId, byLabel);
        }

        // Find sections that have at least one untouched sibling for every
        // canonical slot — those are the only places we can pair safely.
        const candidateLabels = new Set<string>();
        for (const m of poolByCanonByLabel.values()) {
          for (const k of m.keys()) candidateLabels.add(k);
        }

        for (const labelKey of candidateLabels) {
          const sectionLabel = labelKey === "__NULL__" ? null : labelKey;
          // Repeat as long as every canonical still has a sibling in this section.
          while (true) {
            const group: Sibling[] = [];
            let canPair = true;
            for (const canonId of canonicalIds) {
              const pool = poolByCanonByLabel.get(canonId)!.get(labelKey);
              if (!pool || pool.length === 0) {
                canPair = false;
                break;
              }
              group.push(pool[0]);
            }
            if (!canPair) break;
            // Consume picked siblings.
            for (let i = 0; i < canonicalIds.length; i++) {
              poolByCanonByLabel.get(canonicalIds[i])!.get(labelKey)!.shift();
            }

            const groupIds = group.map((g) => g.id);
            const groupEarliest = group.reduce(
              (min, g) => (g.createdAt < min ? g.createdAt : min),
              group[0].createdAt,
            );
            await prisma.$transaction(async (tx) => {
              const cascadeParent = await tx.ticketLine.create({
                data: {
                  ticketId,
                  lineType: seed.lineType,
                  description: String(description).trim(),
                  productCode: productCode?.trim() || null,
                  qty: numQty,
                  unit: resolvedUnit,
                  payingCustomerId: seed.payingCustomerId,
                  siteId: seed.siteId,
                  siteCommercialLinkId: seed.siteCommercialLinkId,
                  sectionLabel,
                  isBomParent: true,
                  status: numCostUnit > 0 ? "PRICED" : "CAPTURED",
                  expectedCostUnit: numCostUnit > 0 ? numCostUnit : null,
                  expectedCostTotal:
                    numCostUnit > 0 ? numCostUnit * numQty : null,
                  createdAt: groupEarliest,
                },
              });
              await tx.ticketLine.updateMany({
                where: { id: { in: groupIds } },
                data: { parentLineId: cascadeParent.id },
              });
            });
            cascadeSummary.cascadedParents++;
          }
        }
      }
    } else {
      cascadeSummary.skippedReason =
        "Cascade skipped — at least one child has no canonical link";
    }

    return Response.json({ ...result, cascade: cascadeSummary }, { status: 201 });
  } catch (error) {
    console.error("Failed to combine lines into BOM:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to combine into BOM",
      },
      { status: 500 }
    );
  }
}
