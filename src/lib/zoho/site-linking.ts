/**
 * Pointer-only mapping of Zoho cfSite text → OS Sites.
 *
 * Same pattern as customer-linking: link rows are pointers, the underlying
 * Zoho line and OS Site stay untouched. Many-to-one supported (e.g. "5 The
 * Walled Garden" + "The Walled Garden" → one OS Site).
 */
import { prisma } from "@/lib/prisma";

export interface LinkArgs {
  cfSites: string[];
  siteId: string;
  notes?: string;
  linkedBy?: string;
}

export async function linkZohoSites(args: LinkArgs) {
  const site = await prisma.site.findUnique({
    where: { id: args.siteId },
    select: { id: true, siteName: true },
  });
  if (!site) throw new Error(`OS Site not found: ${args.siteId}`);

  const distinct = [...new Set(args.cfSites.map((s) => s.trim()).filter(Boolean))];
  if (distinct.length === 0) throw new Error("No cfSites provided");

  return prisma.$transaction(
    distinct.map((cfSite) =>
      prisma.zohoSiteLink.upsert({
        where: { cfSite },
        create: {
          cfSite,
          siteId: site.id,
          notes: args.notes,
          linkedBy: args.linkedBy,
          manualConfirmed: true,
        },
        update: {
          siteId: site.id,
          notes: args.notes,
          linkedBy: args.linkedBy,
          manualConfirmed: true,
          updatedAt: new Date(),
        },
      })
    )
  );
}

export async function unlinkZohoSite(cfSite: string) {
  return prisma.zohoSiteLink.delete({ where: { cfSite } });
}

export async function suggestSiteMatches(cfSite: string, limit = 10) {
  const term = cfSite.trim();
  if (!term) return [];
  return prisma.site.findMany({
    where: {
      OR: [
        { siteName: { contains: term, mode: "insensitive" } },
        { siteCode: { contains: term, mode: "insensitive" } },
        { aliases: { has: term } },
        { siteAliases: { some: { aliasText: { contains: term, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, siteName: true, siteCode: true, postcode: true, city: true },
    take: limit,
    orderBy: { siteName: "asc" },
  });
}
