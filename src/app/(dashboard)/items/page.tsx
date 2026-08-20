import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const category = (params.category ?? "").trim();

  const where: Record<string, unknown> = { isActive: true };
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { aliases: { has: q } },
    ];
  }
  if (category) where.category = category;

  const [items, categories] = await Promise.all([
    prisma.canonicalProduct.findMany({
      where,
      orderBy: [{ name: "asc" }],
      include: {
        _count: {
          select: { ticketLines: true, supplyEvents: true, pricingHistory: true },
        },
      },
    }),
    prisma.canonicalProduct.groupBy({
      by: ["category"],
      where: { isActive: true, category: { not: null } },
      _count: true,
      orderBy: { category: "asc" },
    }),
  ]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">ITEMS</h1>
        <span className="text-[10px] tracking-widest text-[#888888] bb-mono">
          {items.length} canonical product{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <form method="get" className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="code, name, alias"
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[200px]"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">Category</span>
          <select
            name="category"
            defaultValue={category}
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[160px]"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.category ?? ""} value={c.category ?? ""}>
                {c.category} ({c._count})
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          Apply
        </button>
        {(q || category) && (
          <Link
            href="/items"
            className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#FF6600] px-3 py-1.5"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="border border-[#2A2A2A]">
        <table className="w-full text-[11px] bb-mono">
          <thead className="bg-[#1A1A1A] text-[#888] uppercase tracking-widest">
            <tr>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">UoM</th>
              <th className="text-left px-3 py-2">Aliases</th>
              <th className="text-right px-3 py-2">On tickets</th>
              <th className="text-right px-3 py-2">Supply events</th>
              <th className="text-right px-3 py-2">Price history</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-[#666]">
                  No canonical products match.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t border-[#222] hover:bg-[#1A1A1A]">
                  <td className="px-3 py-2 text-[#FF6600]">{it.code}</td>
                  <td className="px-3 py-2 text-[#CCCCCC]">{it.name}</td>
                  <td className="px-3 py-2 text-[#888]">{it.category ?? "—"}</td>
                  <td className="px-3 py-2 text-[#888]">{it.canonicalUom}</td>
                  <td className="px-3 py-2 text-[#666] text-[10px]">
                    {it.aliases.length === 0
                      ? "—"
                      : it.aliases.slice(0, 3).join(", ") +
                        (it.aliases.length > 3 ? ` +${it.aliases.length - 3}` : "")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#CCCCCC]">
                    {it._count.ticketLines}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#888]">
                    {it._count.supplyEvents}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#888]">
                    {it._count.pricingHistory}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
