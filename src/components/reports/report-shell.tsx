import Link from "next/link";
import { ReactNode } from "react";

type DecimalLike = { toString(): string } | string | number | null | undefined;

export function money(val: DecimalLike): string {
  if (val === null || val === undefined) return "—";
  const n = Number(val.toString());
  if (!Number.isFinite(n)) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(val: DecimalLike): number {
  if (val === null || val === undefined) return 0;
  const n = Number(val.toString());
  return Number.isFinite(n) ? n : 0;
}

export function pct(val: DecimalLike): string {
  if (val === null || val === undefined) return "—";
  const n = Number(val.toString());
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function days(from: Date | string | null | undefined, to: Date = new Date()): number | null {
  if (!from) return null;
  const ms = to.getTime() - new Date(from).getTime();
  return Math.floor(ms / 86400000);
}

export function marginColor(margin: number): string {
  if (margin >= 20) return "text-[#00CC66]";
  if (margin >= 10) return "text-[#FF9900]";
  return "text-[#FF3333]";
}

export function ReportShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          {title}
        </h1>
        <Link href="/reports" className="text-[11px] text-[#888888] hover:text-[#FF6600] tracking-widest uppercase">
          ← All reports
        </Link>
      </div>
      {children}
    </div>
  );
}
