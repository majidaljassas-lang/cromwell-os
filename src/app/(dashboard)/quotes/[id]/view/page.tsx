import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { DownloadPdfButton } from "@/components/quotes/download-pdf-button";

export const dynamic = "force-dynamic";

function fmt(val: unknown): string {
  if (val == null) return "—";
  return `£${Number(val).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function QuoteViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { include: { ticketLine: { select: { unit: true, sectionLabel: true } } } },
      customer: true,
      site: true,
      ticket: { select: { title: true } },
    },
  });

  if (!quote) {
    return <div className="p-8 text-center text-[#FF3333]">Quote not found</div>;
  }

  const totalSale = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);

  return (
    <div className="min-h-screen bg-white text-black p-0">
      <div className="max-w-3xl mx-auto py-12 px-10">
        {/* Header */}
        <div className="flex justify-between items-start mb-10">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-black">Cromwell Plumbing Ltd</h1>
            <div className="text-xs text-gray-600 mt-2 leading-relaxed">
              <p>Company ID : 10611686</p>
              <p>423 Harrow Road</p>
              <p>Westminster London W10 4RE</p>
              <p>United Kingdom</p>
              <p>VAT 262 6274 02</p>
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold text-black">QUOTATION</h2>
            <p className="text-sm text-gray-600 mt-1">{quote.quoteNo}</p>
            <p className="text-sm text-gray-600">Version {quote.versionNo}</p>
            <p className="text-sm text-gray-600">{new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
        </div>

        {/* Customer Details */}
        <div className="mb-8 border-t border-gray-200 pt-6">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">To</p>
              <p className="font-semibold text-black">{quote.customer.name}</p>
              {quote.site && <p className="text-sm text-gray-600">Site: {quote.site.siteName}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Reference</p>
              <p className="text-sm text-gray-700">{quote.ticket.title}</p>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <table className="w-full mb-8">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="text-left py-2 text-xs uppercase tracking-widest text-gray-500 font-semibold">#</th>
              <th className="text-left py-2 text-xs uppercase tracking-widest text-gray-500 font-semibold">Description</th>
              <th className="text-center py-2 text-xs uppercase tracking-widest text-gray-500 font-semibold">Qty</th>
              <th className="text-right py-2 text-xs uppercase tracking-widest text-gray-500 font-semibold">Unit Price</th>
              <th className="text-right py-2 text-xs uppercase tracking-widest text-gray-500 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, i) => (
              <Fragment key={line.id}>
                {line.ticketLine?.sectionLabel && (
                  <tr className="border-t-2 border-gray-400">
                    <td colSpan={5} className="py-2 px-2 text-xs font-bold uppercase tracking-widest text-gray-500 bg-gray-50">
                      {line.ticketLine.sectionLabel}
                    </td>
                  </tr>
                )}
              <tr className="border-b border-gray-100">
                <td className="py-3 text-sm text-gray-400">{i + 1}</td>
                <td className="py-3 text-sm font-medium text-black">{line.description}</td>
                <td className="py-3 text-sm text-center tabular-nums">{Number(line.qty)} {line.ticketLine?.unit || ""}</td>
                <td className="py-3 text-sm text-right tabular-nums">{fmt(line.unitPrice)}</td>
                <td className="py-3 text-sm text-right tabular-nums font-medium">{fmt(line.lineTotal)}</td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-10">
          <div className="w-72">
            <div className="flex justify-between py-2.5 border-t border-gray-200">
              <span className="text-sm text-gray-600">Sub Total</span>
              <span className="text-sm tabular-nums">{fmt(totalSale)}</span>
            </div>
            <div className="flex justify-between py-2.5 border-t border-gray-100">
              <span className="text-sm text-gray-600">Standard Rate (20%)</span>
              <span className="text-sm tabular-nums">{fmt(totalSale * 0.2)}</span>
            </div>
            <div className="flex justify-between py-3 border-t-2 border-black">
              <span className="font-bold text-sm">Total</span>
              <span className="font-bold text-sm tabular-nums">{fmt(totalSale * 1.2)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div className="border-t border-gray-200 pt-4 mb-8">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{quote.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 text-center">
          <p className="text-xs text-gray-400">This quotation is valid for 30 days from the date of issue.</p>
          <p className="text-xs text-gray-400 mt-1">All prices include VAT at 20% where applicable.</p>
        </div>

        {/* Download PDF button */}
        <div className="mt-8 text-center print:hidden">
          <DownloadPdfButton quoteId={quote.id} pdfPath={quote.pdfPath} />
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
