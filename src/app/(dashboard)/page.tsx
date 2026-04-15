import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Phase 11 — default landing is the Command Centre. The legacy
 * dashboard view is still reachable at /dashboard; see the nav sidebar.
 */
export default function RootDashboardPage() {
  redirect("/command-centre");
}
