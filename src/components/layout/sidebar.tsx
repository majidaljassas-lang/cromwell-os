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
  ChevronDown,
  ChevronRight,
  Route,
  PackageCheck,
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
      { label: "SITES", href: "/sites", icon: Building2 },
    ],
  },
  {
    label: "PARTIES",
    items: [
      { label: "CUSTOMERS", href: "/customers", icon: Users },
      { label: "SUPPLIERS", href: "/suppliers", icon: Truck },
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
    items: [{ label: "STOCK", href: "/stock", icon: Package }],
  },
  {
    label: "MONEY",
    items: [
      { label: "BILLS", href: "/bills", icon: Receipt },
      { label: "INVOICES", href: "/invoices", icon: FileText },
      { label: "BANKING", href: "/banking", icon: Landmark },
    ],
  },
  {
    label: "INSIGHTS",
    items: [{ label: "REPORTS", href: "/reports", icon: BarChart3 }],
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
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);

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
