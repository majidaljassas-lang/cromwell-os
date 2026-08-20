import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { getPoSubstitutionTracker } from "@/lib/calloffs/substitution/tracker";
import { SubstitutionTracker } from "@/components/po-register/substitution-tracker";

export const dynamic = "force-dynamic";

export default async function PoSubstitutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ callOff?: string }>;
}) {
  const { id } = await params;
  const { callOff } = await searchParams;
  const scopedCallOffId = callOff || null;

  const tracker = await getPoSubstitutionTracker(id, scopedCallOffId);
  if (!tracker) notFound();

  const meta = await prisma.customerPO.findUnique({
    where: { id },
    select: {
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
    },
  });

  const batches = await prisma.callOffSubstitution.findMany({
    where: { customerPOId: id },
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { displayOrder: "asc" } } },
  });
  const callOffNoById = new Map(tracker.callOffs.map((c) => [c.id, c.callOffNo]));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/po-register">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> PO Register
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold">
            Call-off substitutions · PO {tracker.po.poNo}
          </h1>
          <p className="text-sm text-muted-foreground">
            {meta?.customer.name}
            {meta?.site ? ` · ${meta.site.siteName}` : ""} · {tracker.po.poType}
          </p>
        </div>
      </div>

      <SubstitutionTracker
        poId={tracker.po.id}
        callOffs={tracker.callOffs.map((c) => ({
          id: c.id,
          callOffNo: c.callOffNo,
          callOffDate: c.callOffDate.toISOString(),
          status: c.status,
        }))}
        selectedCallOffId={tracker.callOffId}
        lines={tracker.lines}
        batches={batches.map((b) => ({
          id: b.id,
          title: b.title,
          notes: b.notes,
          workflowState: b.workflowState,
          scopeLabel: b.callOffId
            ? `Call-off #${callOffNoById.get(b.callOffId) ?? "?"}`
            : "PO-wide",
          pdfFileName: b.pdfFileName,
          createdAt: b.createdAt.toISOString(),
          appliedAt: b.appliedAt ? b.appliedAt.toISOString() : null,
          lines: b.lines.map((l) => ({
            id: l.id,
            oldDescription: l.oldDescription,
            oldCode: l.oldCode,
            newDescription: l.newDescription,
            newCode: l.newCode,
            qtyToSwap: Number(l.qtyToSwap),
            frozenQty: Number(l.frozenQtySnapshot),
          })),
        }))}
      />
    </div>
  );
}
