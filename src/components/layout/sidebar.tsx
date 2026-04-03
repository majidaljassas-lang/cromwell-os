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
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Work Queue", href: "/work-queue", icon: ListTodo },
  { label: "Jobs / Sites", href: "/sites", icon: Building2 },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Contacts", href: "/contacts", icon: Contact },
  { label: "Tickets", href: "/tickets", icon: Ticket },
  { label: "Suppliers", href: "/suppliers", icon: Package },
  { label: "Procurement", href: "/procurement", icon: ShoppingCart },
  { label: "PO Register", href: "/po-register", icon: FileBarChart },
  { label: "Invoices", href: "/invoices", icon: Receipt },
  { label: "Recovery", href: "/recovery", icon: AlertTriangle },
  { label: "Enquiries", href: "/enquiries", icon: Inbox },
  { label: "Cash Sales", href: "/cash-sales", icon: Banknote },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Site Packs", href: "/site-packs", icon: FolderArchive },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-slate-900 text-white flex flex-col z-40">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Cromwell OS
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
