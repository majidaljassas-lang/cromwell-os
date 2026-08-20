/**
 * Pointer-only mapping of Zoho customers → OS Customers.
 *
 * Adding/removing a ZohoCustomerLink row never modifies the underlying
 * Zoho payload or the OS Customer. Combined views (Customer 360) are
 * computed at query time by JOINing through this table.
 *
 * Many-to-one is supported: multiple zohoCustomerIds can point to the same
 * customerId (group consolidation: GS8 Ltd + Gs8 Two → one OS Customer).
 */
import { prisma } from "@/lib/prisma";

export interface LinkArgs {
  zohoCustomerIds: string[];
  customerId: string;
  notes?: string;
  linkedBy?: string;
}

export async function linkZohoCustomers(args: LinkArgs) {
  const customer = await prisma.customer.findUnique({
    where: { id: args.customerId },
    select: { id: true, name: true },
  });
  if (!customer) throw new Error(`OS Customer not found: ${args.customerId}`);

  const distinct = [...new Set(args.zohoCustomerIds.filter((s) => s && s.trim()))];
  if (distinct.length === 0) throw new Error("No zohoCustomerIds provided");

  // Pull Zoho-side names so we can store them on the link for display.
  const zohoMeta = await prisma.zohoImportedInvoice.findMany({
    where: { zohoCustomerId: { in: distinct } },
    select: { zohoCustomerId: true, customerName: true },
    distinct: ["zohoCustomerId"],
  });
  const nameByZohoId = new Map(zohoMeta.map((m) => [m.zohoCustomerId, m.customerName]));

  return prisma.$transaction(
    distinct.map((zohoCustomerId) =>
      prisma.zohoCustomerLink.upsert({
        where: { zohoCustomerId },
        create: {
          zohoCustomerId,
          zohoCustomerName: nameByZohoId.get(zohoCustomerId) ?? null,
          customerId: customer.id,
          notes: args.notes,
          linkedBy: args.linkedBy,
          manualConfirmed: true,
        },
        update: {
          customerId: customer.id,
          zohoCustomerName: nameByZohoId.get(zohoCustomerId) ?? null,
          notes: args.notes,
          linkedBy: args.linkedBy,
          manualConfirmed: true,
          updatedAt: new Date(),
        },
      })
    )
  );
}

export async function unlinkZohoCustomer(zohoCustomerId: string) {
  return prisma.zohoCustomerLink.delete({ where: { zohoCustomerId } });
}

/**
 * Suggest OS Customers that may match a given Zoho customer name.
 * Conservative — exact-match against name, legalName, and CustomerAlias.aliasText.
 */
export async function suggestCustomerMatches(zohoCustomerName: string, limit = 10) {
  const term = zohoCustomerName.trim();
  if (!term) return [];
  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { legalName: { contains: term, mode: "insensitive" } },
        { customerAliases: { some: { aliasText: { contains: term, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, name: true, legalName: true, companyNumber: true },
    take: limit,
    orderBy: { name: "asc" },
  });
}
