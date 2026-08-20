"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  Ticket,
  Inbox,
  Package,
  Truck,
  Receipt,
  FileText,
  BarChart3,
  Landmark,
  Banknote,
  ChevronDown,
  ChevronRight,
  Route,
  PackageCheck,
  ClipboardList,
  ShoppingCart,
  ScrollText,
  RotateCcw,
  Contact,
  UserCheck,
  GitMerge,
  History,
  Wrench,
  Calculator,
  BookOpen,
  PiggyBank,
  CalendarClock,
  Database,
  RefreshCcw,
  FolderArchive,
  KeyRound,
  Box,
  Activity,
  Sparkles,
  TrendingUp,
  Scale,
  HelpCircle,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavSection = {
  label: string | null;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: null,
    items: [{ label: "DASHBOARD", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "OPERATIONS",
    items: [
      { label: "INBOX", href: "/inbox", icon: Inbox },
      { label: "TICKETS", href: "/tickets", icon: Ticket },
      { label: "TICKETS · MERGE", href: "/tickets/merge", icon: GitMerge },
      { label: "SITES", href: "/sites", icon: Building2 },
      { label: "HIRES", href: "/hires", icon: KeyRound },
      { label: "SITE PACKS", href: "/site-packs", icon: FolderArchive },
      { label: "ENQUIRIES", href: "/enquiries", icon: HelpCircle },
    ],
  },
  {
    label: "SALES",
    items: [
      { label: "QUOTES", href: "/quotes", icon: ScrollText },
      { label: "PO REGISTER", href: "/po-register", icon: ClipboardList },
    ],
  },
  {
    label: "PROCUREMENT",
    items: [
      { label: "PROCUREMENT", href: "/procurement", icon: ShoppingCart },
      { label: "RETURNS", href: "/returns", icon: RotateCcw },
    ],
  },
  {
    label: "LOGISTICS",
    items: [
      { label: "DELIVERIES", href: "/deliveries", icon: Route },
      { label: "INBOUND", href: "/orders/inbound", icon: PackageCheck },
    ],
  },
  {
    label: "CATALOG",
    items: [
      { label: "ITEMS", href: "/items", icon: Box },
      { label: "STOCK", href: "/stock", icon: Package },
    ],
  },
  {
    label: "PARTIES",
    items: [
      { label: "CUSTOMERS", href: "/customers", icon: Users },
      { label: "CUSTOMERS · CLEANUP", href: "/customers/cleanup", icon: Sparkles },
      { label: "SUPPLIERS", href: "/suppliers", icon: Truck },
      { label: "SUPPLIERS · DEDUPE", href: "/suppliers/dedupe", icon: GitMerge },
      { label: "CONTACTS", href: "/contacts", icon: Contact },
      { label: "REVIEW QUEUE", href: "/parties/review", icon: UserCheck },
    ],
  },
  {
    label: "MONEY",
    items: [
      { label: "BILLS", href: "/bills", icon: Receipt },
      { label: "ACCOUNTS PAYABLE", href: "/accounts-payable", icon: Wrench },
      { label: "INVOICES", href: "/invoices", icon: FileText },
      { label: "CASH SALES", href: "/cash-sales", icon: Banknote },
      { label: "BANKING", href: "/banking", icon: Landmark },
      { label: "RECONCILIATION", href: "/reconciliation", icon: GitMerge },
    ],
  },
  {
    label: "FINANCE",
    items: [
      { label: "CHART OF ACCOUNTS", href: "/finance", icon: BookOpen },
      { label: "JOURNALS", href: "/finance/journals", icon: ScrollText },
      { label: "PAYMENTS", href: "/finance/payments", icon: PiggyBank },
      { label: "BANK INBOX", href: "/finance/bank-inbox", icon: Inbox },
      { label: "PERIOD CLOSE", href: "/finance/period-close", icon: CalendarClock },
      { label: "VAT", href: "/finance/reports/vat", icon: Calculator },
      { label: "CT", href: "/ct", icon: Calculator },
    ],
  },
  {
    label: "REPORTS",
    items: [
      { label: "REPORTS HOME", href: "/reports", icon: BarChart3 },
      { label: "FINANCE REPORTS", href: "/finance/reports", icon: BarChart3 },
      { label: "TRIAL BALANCE", href: "/finance/reports/trial-balance", icon: Scale },
      { label: "P & L", href: "/finance/reports/p-and-l", icon: TrendingUp },
      { label: "AGED DEBTORS", href: "/finance/reports/aged-debtors", icon: Users },
      { label: "AGED CREDITORS", href: "/finance/reports/aged-creditors", icon: Truck },
      { label: "GENERAL LEDGER", href: "/finance/reports/general-ledger", icon: BookOpen },
    ],
  },
  {
    label: "RECOVERY / BACKLOG",
    items: [
      { label: "RECOVERY", href: "/recovery", icon: History },
      { label: "BACKLOG", href: "/backlog", icon: FolderArchive },
      { label: "FINANCE · BACKLOG", href: "/finance/backlog", icon: FolderArchive },
      { label: "ZOHO CLEANUP", href: "/finance/backlog/cleanup", icon: Sparkles },
      { label: "ZOHO RECON", href: "/zoho-recon", icon: RefreshCcw },
      { label: "ZOHO RECON · MAIN", href: "/zoho-recon/main", icon: RefreshCcw },
      { label: "ZOHO RECON · REVIEW", href: "/zoho-recon/review", icon: RefreshCcw },
    ],
  },
  {
    label: "DATA / ADMIN",
    items: [
      { label: "INGESTION", href: "/ingestion", icon: Database },
      { label: "INTAKE HEALTH", href: "/admin/intake-health", icon: Activity },
    ],
  },
];

const STORAGE_KEY = "cromwell-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCollapsed(JSON.parse(saved));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {}
  }, [collapsed, hydrated]);

  const toggleSection = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Pick the single item with the longest href that matches the current
  // pathname so nested routes (e.g. /finance/journals) don't double-highlight
  // a parent (/finance).
  const allItems = navSections.flatMap((s) => s.items);
  const matches = allItems.filter((it) =>
    it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(it.href + "/"),
  );
  const activeHref =
    matches.length > 0
      ? matches.reduce((best, it) => (it.href.length > best.href.length ? it : best)).href
      : null;

  return (
    <aside className="fixed left-0 top-0 h-full w-56 bg-[#111111] border-r border-[#2A2A2A] flex flex-col z-40">
      {/* Bloomberg-style header */}
      <div className="px-4 py-3 border-b border-[#2A2A2A]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-[#FF6600] rounded-full animate-pulse" />
          <span className="text-sm font-bold tracking-widest text-[#FF6600] bb-mono">
            CROMWELL
          </span>
        </div>
        <div className="text-[10px] tracking-[0.2em] text-[#666666] mt-0.5 bb-mono">
          COMMERCIAL OS
        </div>
      </div>

      <nav className="flex-1 py-2 overflow-y-auto">
        {navSections.map((section, idx) => {
          const isCollapsed = section.label ? !!collapsed[section.label] : false;

          return (
            <div key={idx} className={idx > 0 ? "mt-3" : ""}>
              {section.label && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label!)}
                  className="w-full flex items-center justify-between px-4 py-1 text-[9px] tracking-[0.2em] text-[#555555] hover:text-[#FF6600] bb-mono transition-colors"
                >
                  <span>{section.label}</span>
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              )}
              {!isCollapsed &&
                section.items.map((item) => {
                  const isActive = item.href === activeHref;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-4 py-1.5 text-[11px] font-medium tracking-wider transition-colors bb-mono ${
                        isActive
                          ? "bg-[#FF6600] text-black"
                          : "text-[#888888] hover:bg-[#1A1A1A] hover:text-[#FF6600]"
                      }`}
                    >
                      <item.icon className="h-3.5 w-3.5 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
