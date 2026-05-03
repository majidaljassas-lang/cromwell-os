/**
 * Quick-create an end-user cash client.
 *
 * Pattern: each cash client is a lightweight subsidiary of "Cash Accounts"
 * (isBillingEntity=false, isCashCustomer=true) linked to one Site representing
 * their job address. Billing details inherit up to Cash Accounts.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Body = {
  clientName?: string;
  siteName?: string;
  postcode?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const clientName = body.clientName?.trim() ?? "";
  const siteName = body.siteName?.trim() ?? "";
  const postcode = body.postcode?.trim() || null;

  if (!clientName) return NextResponse.json({ error: "clientName required" }, { status: 400 });
  if (!siteName)   return NextResponse.json({ error: "siteName required" }, { status: 400 });

  const cashAccounts = await prisma.customer.findFirst({
    where: { name: "Cash Accounts" },
    select: { id: true },
  });
  if (!cashAccounts) {
    return NextResponse.json(
      { error: "'Cash Accounts' bucket customer not found — create it first" },
      { status: 500 },
    );
  }

  const existingDup = await prisma.customer.findFirst({
    where: {
      name: { equals: clientName, mode: "insensitive" },
      parentCustomerEntityId: cashAccounts.id,
    },
    select: { id: true, name: true },
  });
  if (existingDup) {
    return NextResponse.json(
      { error: `client "${existingDup.name}" already exists under Cash Accounts`, existingId: existingDup.id },
      { status: 409 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.customer.create({
      data: {
        name: clientName,
        parentCustomerEntityId: cashAccounts.id,
        isCashCustomer: true,
        isBillingEntity: false,
      },
      select: { id: true, name: true },
    });
    const site = await tx.site.create({
      data: { siteName, postcode: postcode ?? undefined },
      select: { id: true, siteName: true },
    });
    const link = await tx.siteCommercialLink.create({
      data: {
        siteId: site.id,
        customerId: client.id,
        role: "CLIENT",
        billingAllowed: true,
        defaultBillingCustomer: true,
        isActive: true,
      },
      select: { id: true },
    });
    return { client, site, linkId: link.id };
  });

  return NextResponse.json({ ok: true, ...result });
}
