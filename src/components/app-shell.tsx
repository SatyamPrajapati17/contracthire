import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { RoleBadge } from "./role-badge";

const RAIL = [
  { href: "", label: "Dashboard", icon: "◎" },
  { href: "/contracts", label: "Contracts", icon: "▤" },
  { href: "/obligations", label: "Obligations", icon: "☑" },
  { href: "/risk", label: "Risk queue", icon: "△" },
  { href: "/alerts", label: "Alerts", icon: "◔" },
  { href: "/activity", label: "Agent activity", icon: "⚙" },
  { href: "/settings/connections", label: "Connections", icon: "⇄" },
  { href: "/settings/security", label: "Security", icon: "◍" },
  { href: "/settings/audit", label: "Audit", icon: "☰" }
];

export async function AppShell({ workspaceId, children, active }: { workspaceId: string; children: React.ReactNode; active: string }) {
  const ctx = await getCtx();
  const ws = (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
  if (!ws) return <main id="main" className="p-10">Workspace not found.</main>;
  const base = `/w/${workspaceId}`;

  return (
    <div className="min-h-screen flex">
      <a id="main" />
      <aside className="w-[248px] shrink-0 border-r border-ash bg-surface min-h-screen hidden md:block">
        <div className="p-6">
          <Link href={`${base}/dashboard`} className="font-serif text-xl text-ink">ContractLens</Link>
          <p className="text-xs text-smoke mt-1">{ws.name}</p>
        </div>
        <nav aria-label="Primary" className="px-3">
          {RAIL.map((item) => {
            const isActive = active === item.href || (item.href && active.startsWith(item.href));
            return (
              <Link key={item.label} href={`${base}${item.href}`}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-input text-sm mb-0.5 ${isActive ? "bg-lake-tint text-lake font-medium" : "text-graphite hover:text-offblack hover:bg-lake-tint"}`}>
                <span aria-hidden className="w-4 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 mt-10">
          <p className="text-xs text-smoke">Signed in as</p>
          <p className="text-xs text-offblack truncate">{ctx?.email}</p>
          {ctx && <RoleBadge role={ctx.role} />}
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="h-14 border-b border-ash bg-surface flex items-center px-4 sm:px-6 gap-3">
          <Link href={`${base}/dashboard`} className="md:hidden font-serif text-lg">ContractLens</Link>
          <span className="text-xs text-smoke truncate">{ws.name}</span>
          <span className="ml-auto text-xs text-smoke hidden lg:inline">Demo environment — seeded data, non-production</span>
          <a
            href="/api/auth/signout"
            aria-label="Sign out of ContractLens"
            className="rounded-pill border border-ash px-3.5 py-1.5 text-xs font-medium text-graphite hover:text-offblack hover:border-periwinkle-deep hover:bg-lake-tint transition-colors shrink-0"
          >
            Sign out
          </a>
        </div>
        <main id="content" className="max-w-content mx-auto px-4 sm:px-8 py-6 sm:py-10 page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}
