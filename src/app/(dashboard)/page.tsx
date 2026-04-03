import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';

  let execData = null;
  let opsData = null;

  try {
    const [execRes, opsRes] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard/executive`, { cache: 'no-store' }),
      fetch(`${baseUrl}/api/dashboard/operations`, { cache: 'no-store' }),
    ]);
    if (execRes.ok) execData = await execRes.json();
    if (opsRes.ok) opsData = await opsRes.json();
  } catch {
    // Dashboard still renders with null data
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <DashboardView executive={execData} operations={opsData} />
    </div>
  );
}
