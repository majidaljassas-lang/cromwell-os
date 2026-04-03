"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  Building2,
  Users,
  Contact,
  Ticket,
  Inbox,
  Package,
  ShoppingCart,
  FileBarChart,
  Receipt,
  AlertTriangle,
  Banknote,
  BarChart3,
  FolderArchive,
} from "lucide-react";

const navItems = [
  { label: "DASHBOARD", href: "/", icon: LayoutDashboard },
  { label: "WORK QUEUE", href: "/work-queue", icon: ListTodo },
  { label: "JOBS / SITES", href: "/sites", icon: Building2 },
  { label: "CUSTOMERS", href: "/customers", icon: Users },
  { label: "CONTACTS", href: "/contacts", icon: Contact },
  { label: "TICKETS", href: "/tickets", icon: Ticket },
  { label: "SUPPLIERS", href: "/suppliers", icon: Package },
  { label: "PROCUREMENT", href: "/procurement", icon: ShoppingCart },
  { label: "PO REGISTER", href: "/po-register", icon: FileBarChart },
  { label: "INVOICES", href: "/invoices", icon: Receipt },
  { label: "RECOVERY", href: "/recovery", icon: AlertTriangle },
  { label: "ENQUIRIES", href: "/enquiries", icon: Inbox },
  { label: "CASH SALES", href: "/cash-sales", icon: Banknote },
  { label: "REPORTS", href: "/reports", icon: BarChart3 },
  { label: "SITE PACKS", href: "/site-packs", icon: FolderArchive },
];

export function Sidebar() {
  const pathname = usePathname();

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
        {navItems.map((item) => {
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
      </nav>

      {/* Status bar at bottom */}
      <div className="px-4 py-2 border-t border-[#2A2A2A] text-[9px] text-[#555555] bb-mono">
        <div className="flex justify-between">
          <span>SYS ONLINE</span>
          <span className="text-[#00CC66]">LIVE</span>
        </div>
      </div>
    </aside>
  );
}
