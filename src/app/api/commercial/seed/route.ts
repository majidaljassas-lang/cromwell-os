import { prisma } from "@/lib/prisma";

/**
 * POST /api/commercial/seed
 *
 * Seeds canonical products, substitution families, UOM conversions,
 * and site aliases for Dellow Centre (Shuttleworth - Stratford).
 *
 * Idempotent — uses upsert to avoid duplicates.
 */
export async function POST() {
  try {
    // ─── CANONICAL PRODUCTS ───────────────────────────────────────────
    const products = [
      { code: "PLASTERBOARD_12.5MM", name: "Plasterboard 12.5mm", category: "DRYLINING", canonicalUom: "EA", aliases: ["board", "standard board", "gtec board", "siniat board"] },
      { code: "PLASTERBOARD_15MM", name: "Plasterboard 15mm (Fireline)", category: "DRYLINING", canonicalUom: "EA", aliases: ["fireline", "fire board", "15mm board"] },
      { code: "C_STUD", name: "C-Stud (Metal Stud)", category: "DRYLINING", canonicalUom: "LENGTH", aliases: ["metal stud", "CS70", "c stud"] },
      { code: "TRACK_DEEP_FLANGE", name: "U-Track Deep Flange", category: "DRYLINING", canonicalUom: "LENGTH", aliases: ["deep flange track", "deep track"] },
      { code: "TRACK_STANDARD", name: "U-Track Standard", category: "DRYLINING", canonicalUom: "LENGTH", aliases: ["standard track", "72mm track"] },
      { code: "FLAT_STRAP", name: "Flat Strap", category: "DRYLINING", canonicalUom: "LENGTH", aliases: ["siniat flat strap"] },
      { code: "INSULATION_25MM", name: "Insulation 25mm", category: "INSULATION", canonicalUom: "M2", aliases: ["mineral wool", "acoustic roll", "25mm mineral"] },
      { code: "INSULATION_50MM", name: "Insulation 50mm", category: "INSULATION", canonicalUom: "M2", aliases: ["50mm insulation"] },
      { code: "INSULATION_100MM", name: "Insulation 100mm", category: "INSULATION", canonicalUom: "M2", aliases: ["100mm insulation"] },
      { code: "DRYWALL_SCREWS", name: "Drywall Screws", category: "FIXINGS", canonicalUom: "EA", aliases: ["board screws"] },
      { code: "WOOD_SCREWS", name: "Wood Screws", category: "FIXINGS", canonicalUom: "EA", aliases: [] },
      { code: "FILLER", name: "Easy Filler / Easifill", category: "FINISHING", canonicalUom: "EA", aliases: ["easifill", "easy filler"] },
      { code: "PLASTER_BEAD", name: "Plaster Bead (Galvanised)", category: "FINISHING", canonicalUom: "LENGTH", aliases: ["galvanised bead"] },
      { code: "JOINTING_TAPE", name: "Jointing Tape / Scrim", category: "FINISHING", canonicalUom: "EA", aliases: ["scrim", "scrim tape"] },
      { code: "GRAB_ADHESIVE", name: "Grab Adhesive", category: "ADHESIVES", canonicalUom: "EA", aliases: ["sticks like sh*t", "stick like"] },
      { code: "TILE_ADHESIVE", name: "Tile Adhesive", category: "ADHESIVES", canonicalUom: "EA", aliases: [] },
      { code: "SILICONE_WHITE", name: "Silicone White", category: "SEALANTS", canonicalUom: "EA", aliases: [] },
      { code: "SILICONE_CLEAR", name: "Silicone Clear", category: "SEALANTS", canonicalUom: "EA", aliases: [] },
      { code: "COPPER_PIPE_15MM", name: "Copper Pipe 15mm", category: "PLUMBING", canonicalUom: "M", aliases: ["15mm copper"] },
      { code: "COPPER_PIPE_22MM", name: "Copper Pipe 22mm", category: "PLUMBING", canonicalUom: "M", aliases: ["22mm copper"] },
      { code: "COPPER_PIPE_28MM", name: "Copper Pipe 28mm", category: "PLUMBING", canonicalUom: "M", aliases: ["28mm copper"] },
    ];

    const productIds: Record<string, string> = {};

    for (const p of products) {
      const existing = await prisma.canonicalProduct.findUnique({ where: { code: p.code } });
      if (existing) {
        productIds[p.code] = existing.id;
      } else {
        const created = await prisma.canonicalProduct.create({ data: p });
        productIds[p.code] = created.id;
      }
    }

    // ─── SUBSTITUTION FAMILIES ────────────────────────────────────────
    const families = [
      {
        familyCode: "TRACK_FAMILY",
        name: "Track Family (Deep Flange / Standard)",
        members: ["TRACK_DEEP_FLANGE", "TRACK_STANDARD"],
        substitutionAllowed: true,
        directionality: "BIDIRECTIONAL",
        evidenceRequired: true,
      },
      {
        familyCode: "PLASTERBOARD_FAMILY",
        name: "Plasterboard Family",
        members: ["PLASTERBOARD_12.5MM", "PLASTERBOARD_15MM"],
        substitutionAllowed: true,
        directionality: "ONE_WAY",
        evidenceRequired: true,
        notes: "15mm can substitute 12.5mm but not vice versa (fire rating)",
      },
      {
        familyCode: "INSULATION_FAMILY",
        name: "Insulation Family",
        members: ["INSULATION_25MM", "INSULATION_50MM", "INSULATION_100MM"],
        substitutionAllowed: false,
        directionality: "NONE",
        evidenceRequired: true,
        notes: "Different thicknesses are NOT interchangeable — different thermal performance",
      },
    ];

    for (const fam of families) {
      const existing = await prisma.substitutionFamily.findUnique({
        where: { familyCode: fam.familyCode },
      });

      let familyId: string;
      if (existing) {
        familyId = existing.id;
      } else {
        const created = await prisma.substitutionFamily.create({
          data: {
            familyCode: fam.familyCode,
            name: fam.name,
            substitutionAllowed: fam.substitutionAllowed,
            directionality: fam.directionality,
            evidenceRequired: fam.evidenceRequired,
            notes: fam.notes,
          },
        });
        familyId = created.id;
      }

      // Add members
      for (let i = 0; i < fam.members.length; i++) {
        const productCode = fam.members[i];
        const productId = productIds[productCode];
        if (!productId) continue;

        const existingMember = await prisma.substitutionFamilyMember.findUnique({
          where: { familyId_canonicalProductId: { familyId, canonicalProductId: productId } },
        });
        if (!existingMember) {
          await prisma.substitutionFamilyMember.create({
            data: {
              familyId,
              canonicalProductId: productId,
              isPrimary: i === 0,
              sortOrder: i,
            },
          });
        }
      }
    }

    // ─── UOM CONVERSIONS ──────────────────────────────────────────────
    const conversions = [
      { product: "TRACK_DEEP_FLANGE", fromUom: "LENGTH", toUom: "M", factor: 3.0 },
      { product: "TRACK_STANDARD", fromUom: "LENGTH", toUom: "M", factor: 3.0 },
      { product: "C_STUD", fromUom: "LENGTH", toUom: "M", factor: 3.0 },
      { product: "FLAT_STRAP", fromUom: "LENGTH", toUom: "M", factor: 2.4 },
      { product: "PLASTER_BEAD", fromUom: "LENGTH", toUom: "M", factor: 2.4 },
      { product: "FLAT_STRAP", fromUom: "COIL", toUom: "M", factor: 30.0 },
    ];

    for (const conv of conversions) {
      const productId = productIds[conv.product];
      if (!productId) continue;

      const existing = await prisma.uomConversion.findUnique({
        where: {
          canonicalProductId_fromUom_toUom: {
            canonicalProductId: productId,
            fromUom: conv.fromUom,
            toUom: conv.toUom,
          },
        },
      });
      if (!existing) {
        await prisma.uomConversion.create({
          data: {
            canonicalProductId: productId,
            fromUom: conv.fromUom,
            toUom: conv.toUom,
            factor: conv.factor,
            isVerified: true,
          },
        });
      }
    }

    // ─── SITE ALIAS: Dellow Centre → Shuttleworth - Stratford ────────
    // Find or note about the site
    const shuttleworthSites = await prisma.site.findMany({
      where: {
        OR: [
          { siteName: { contains: "Shuttleworth", mode: "insensitive" } },
          { siteName: { contains: "Dellow", mode: "insensitive" } },
          { siteName: { contains: "Stratford", mode: "insensitive" } },
        ],
      },
    });

    let siteInfo: string;
    if (shuttleworthSites.length > 0) {
      const site = shuttleworthSites[0];
      siteInfo = `Found existing site: ${site.siteName} (${site.id})`;

      // Add aliases if not present
      const aliasTexts = ["Dellow Centre", "Shuttleworth Stratford", "Shuttleworth - Stratford"];
      for (const aliasText of aliasTexts) {
        const existing = await prisma.siteAlias.findFirst({
          where: { siteId: site.id, aliasText },
        });
        if (!existing) {
          await prisma.siteAlias.create({
            data: {
              siteId: site.id,
              aliasText,
              sourceType: "MANUAL",
              aliasSource: "COMMERCIAL_SEED",
              manualConfirmed: true,
              confidenceDefault: 100,
            },
          });
        }
      }
    } else {
      // Create the site
      const site = await prisma.site.create({
        data: {
          siteName: "Shuttleworth - Stratford",
          aliases: ["Dellow Centre", "Shuttleworth Stratford"],
          notes: "Dellow Centre site - Shuttleworth project, Stratford location",
        },
      });
      siteInfo = `Created site: ${site.siteName} (${site.id})`;

      // Add formal aliases
      const aliasTexts = ["Dellow Centre", "Shuttleworth Stratford"];
      for (const aliasText of aliasTexts) {
        await prisma.siteAlias.create({
          data: {
            siteId: site.id,
            aliasText,
            sourceType: "MANUAL",
            aliasSource: "COMMERCIAL_SEED",
            manualConfirmed: true,
            confidenceDefault: 100,
          },
        });
      }
    }

    return Response.json({
      success: true,
      products: products.length,
      families: families.length,
      conversions: conversions.length,
      site: siteInfo,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("Failed to seed commercial data:", msg, stack);
    return Response.json({ error: "Failed to seed commercial data", detail: msg }, { status: 500 });
  }
}
