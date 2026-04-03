import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <Sidebar />
      <main className="pl-56 min-h-screen">{children}</main>
    </div>
  );
}
