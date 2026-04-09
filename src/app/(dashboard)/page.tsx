import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';

  let execData = null;

  try {
    const execRes = await fetch(`${baseUrl}/api/dashboard/executive`, { cache: 'no-store' });
    if (execRes.ok) execData = await execRes.json();
  } catch {
    // Dashboard still renders with null data
  }

  return (
    <div className="p-4 space-y-4 bg-[#0D0D0D]">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">DASHBOARD</h1>
      <DashboardView executive={execData} />
    </div>
  );
}
