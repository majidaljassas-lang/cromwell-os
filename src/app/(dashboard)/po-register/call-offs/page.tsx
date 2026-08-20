import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const gbp = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function CallOffPOsIndex() {
  const pos = await prisma.customerPO.findMany({
    where: { callOffs: { some: {} } },
    orderBy: { poNo: "asc" },
    select: {
      id: true,
      poNo: true,
      status: true,
      poConsumedValue: true,
      poRemainingValue: true,
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
      _count: { select: { callOffs: true } },
    },
  });

  // Delivered value per PO = qty on delivery notes × PO-line price (same basis
  // as poConsumedValue), so Outstanding = Called-off − Delivered lines up.
  const deliveredRows = await prisma.$queryRaw<Array<{ po_id: string; delivered_value: number }>>`
    SELECT po.id AS po_id,
           COALESCE(SUM(dnl."qtyDelivered" * pol."agreedUnitPrice"), 0)::float8 AS delivered_value
    FROM "CustomerPO" po
    JOIN "CallOff" c ON c."customerPOId" = po.id
    JOIN "DeliveryNote" dn ON dn."callOffId" = c.id
    JOIN "DeliveryNoteLine" dnl ON dnl."deliveryNoteId" = dn.id
    JOIN "CustomerPOLine" pol ON pol."ticketLineId" = dnl."ticketLineId" AND pol."customerPOId" = po.id
    GROUP BY po.id
  `;
  const deliveredByPo = new Map(deliveredRows.map((r) => [r.po_id, Number(r.delivered_value)]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/po-register">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to PO register
          </Button>
        </Link>
        <h1 className="text-lg font-medium">Call-off POs</h1>
        <span className="text-xs text-muted-foreground">{pos.length} PO{pos.length === 1 ? "" : "s"} with call-offs</span>
      </div>

      <div className="rounded border">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left border-b">
              <th className="px-3 py-2 font-normal">PO</th>
              <th className="px-3 py-2 font-normal">Customer</th>
              <th className="px-3 py-2 font-normal">Site</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal text-right">Call-offs</th>
              <th className="px-3 py-2 font-normal text-right">Called off £</th>
              <th className="px-3 py-2 font-normal text-right">Delivered £</th>
              <th className="px-3 py-2 font-normal text-right">Outstanding £</th>
              <th className="px-3 py-2 font-normal text-right">Remaining PO £</th>
              <th className="px-3 py-2 font-normal text-right">Reconcile</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => {
              const calledOff = Number(po.poConsumedValue ?? 0);
              const delivered = deliveredByPo.get(po.id) ?? 0;
              const outstanding = Math.max(0, calledOff - delivered);
              return (
              <tr key={po.id} className="border-t hover:bg-muted/40">
                <td className="px-3 py-2 font-medium">{po.poNo}</td>
                <td className="px-3 py-2">{po.customer.name}</td>
                <td className="px-3 py-2">{po.site?.siteName ?? "—"}</td>
                <td className="px-3 py-2">{po.status}</td>
                <td className="px-3 py-2 text-right tabular-nums">{po._count.callOffs}</td>
                <td className="px-3 py-2 text-right tabular-nums">£{gbp(calledOff)}</td>
                <td className="px-3 py-2 text-right tabular-nums">£{gbp(delivered)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${outstanding > 0 ? "text-[#FF9900] font-medium" : "text-muted-foreground"}`}>£{gbp(outstanding)}</td>
                <td className="px-3 py-2 text-right tabular-nums">£{gbp(Number(po.poRemainingValue ?? 0))}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/po-register/${po.id}/call-off`}>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                      Open <ArrowRight className="size-3 ml-1" />
                    </Button>
                  </Link>
                </td>
              </tr>
              );
            })}
            {pos.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No POs have call-offs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
