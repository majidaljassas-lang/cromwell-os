import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: siteId } = await params;
  try {
    const { customerId, role, billingAllowed, defaultBillingCustomer } =
      await request.json();

    const link = await prisma.siteCommercialLink.create({
      data: {
        siteId,
        customerId,
        role,
        billingAllowed: billingAllowed ?? false,
        defaultBillingCustomer: defaultBillingCustomer ?? false,
      },
    });
    return Response.json(link, { status: 201 });
  } catch (error) {
    console.error("Failed to create commercial link:", error);
    return Response.json(
      { error: "Failed to create commercial link" },
      { status: 500 }
    );
  }
}
