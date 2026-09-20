/* Phase 8 integration test: walks every mutating action × every role against
   the permission matrix (doc 06 §9). Verifies exact status codes:
     - 404 for cross-workspace access (existence never disclosed)
     - 403 for in-workspace unauthorized actions
     - 2xx for authorized actions
   and that authorized mutations wrote audit_events rows.
   Run: npx tsx scripts/test-rbac.ts   (app must run on localhost:3000) */
import "dotenv/config";

const BASE = process.env.APP_URL || "http://localhost:3000";
const ROLES = ["workspace_admin", "legal_reviewer", "contract_owner", "contributor", "viewer", "external_signer"] as const;
type Role = (typeof ROLES)[number];

/* ── expectations from src/lib/auth.ts ── */
const canEdit = (r: Role) => !["viewer", "external_signer"].includes(r);           // contributor+
const canDecide = (r: Role) => r === "legal_reviewer" || r === "workspace_admin";
const isAdmin = (r: Role) => r === "workspace_admin";

interface Cell { action: string; role: Role; want: number; got: number; ok: boolean }
const results: Cell[] = [];

async function magicSession(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/magic-link`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  const body = await res.json() as { dev_url?: string; error?: unknown };
  if (!body.dev_url) throw new Error(`no dev_url for ${email}: ${JSON.stringify(body)}`);
  const verify = await fetch(body.dev_url.startsWith("http") ? body.dev_url : `${BASE}${body.dev_url}`, { redirect: "manual" });
  const cookie = verify.headers.get("set-cookie") ?? "";
  if (!cookie.includes("cl_session") && !cookie.includes("session")) {
    // Fall back to following the redirect chain manually.
    const follow = await fetch(body.dev_url.startsWith("http") ? body.dev_url : `${BASE}${body.dev_url}`);
    void follow;
    throw new Error(`no session cookie for ${email}`);
  }
  return cookie.split(";")[0];
}

async function call(cookie: string, method: string, path: string, body?: unknown): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  // Drain the body so the socket is released.
  await res.text();
  return res.status;
}

async function main() {
  const { db, pool } = await import("../src/lib/db/client");
  const { id } = await import("../src/lib/ids");
  const { workspaces, memberships, users } = await import("../src/lib/db/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");

  /* ── 1. Fixture workspace + one user per role ── */
  const wsId = id("ws");
  const ws2Id = id("ws");
  await db.insert(workspaces).values([{ id: wsId, name: "RBAC Test WS" }, { id: ws2Id, name: "RBAC Other WS" }]);

  const emails: Record<Role, string> = {
    workspace_admin: `rbac-admin-${Date.now()}@test.example`,
    legal_reviewer: `rbac-reviewer-${Date.now()}@test.example`,
    contract_owner: `rbac-owner-${Date.now()}@test.example`,
    contributor: `rbac-contrib-${Date.now()}@test.example`,
    viewer: `rbac-viewer-${Date.now()}@test.example`,
    external_signer: `rbac-external-${Date.now()}@test.example`
  };
  const userIds: Record<Role, string> = {} as Record<Role, string>;
  for (const role of ROLES) {
    const uid = id("usr");
    userIds[role] = uid;
    await db.insert(users).values({ id: uid, email: emails[role], displayName: `RBAC ${role}` });
    await db.insert(memberships).values({ id: id("mem"), workspaceId: wsId, userId: uid, role });
  }
  // An outsider who is a member of ws2 only (cross-workspace probes).
  const outsiderEmail = `rbac-outsider-${Date.now()}@test.example`;
  const outsiderId = id("usr");
  await db.insert(users).values({ id: outsiderId, email: outsiderEmail });
  await db.insert(memberships).values({ id: id("mem"), workspaceId: ws2Id, userId: outsiderId, role: "workspace_admin" });

  /* ── 2. Sessions via magic link ── */
  const jar: Partial<Record<Role, string>> = {};
  for (const role of ROLES) jar[role] = await magicSession(emails[role]);
  const outsiderCookie = await magicSession(outsiderEmail);

  const admin = jar.workspace_admin!;

  /* ── 3. Seed entities via the API as admin ── */
  const ctRes = await fetch(`${BASE}/api/contracts`, {
    method: "POST", headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ title: "RBAC Test MSA", counterparty_name: "Testco" })
  });
  const ct = await ctRes.json() as { contract_id: string };
  const ctId = ct.contract_id;
  if (!ctId) throw new Error(`contract create failed: ${JSON.stringify(ct)}`);

  // API-created contracts have no current_version_id; attach one so the
  // obligation/risk creation endpoints (which require it) accept writes.
  const { documentVersions } = await import("../src/lib/db/contracts-schema");
  const dvId = id("dv");
  await db.insert(documentVersions).values({
    id: dvId,
    workspaceId: wsId,
    contractId: ctId,
    versionLabel: "v1",
    versionNumber: 1,
    filename: "rbac-test.txt",
    mimeType: "text/plain",
    byteSize: 10,
    sha256: "0".repeat(64),
    storageKey: `w/${wsId}/c/${ctId}/v/${dvId}/original.txt`,
    uploadedBy: userIds.workspace_admin,
    status: "ready"
  });
  const drizzle = await import("drizzle-orm");
  const contractsMod = await import("../src/lib/db/contracts-schema");
  await db.update(contractsMod.contracts)
    .set({ currentVersionId: dvId })
    .where(drizzle.eq(contractsMod.contracts.id, ctId));

  const obRes = await fetch(`${BASE}/api/contracts/${ctId}/obligations`, {
    method: "POST", headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({
      title: "Pay invoices", obligor: "Testco", obligee: "Us",
      due_rule: "relative", due_rule_detail: { anchor: "invoice_date", offset_days: 30 },
      priority: "high"
    })
  });
  const ob = await obRes.json() as { id: string };
  if (!ob.id) throw new Error(`obligation create failed: ${JSON.stringify(ob)}`);

  const rfRes = await fetch(`${BASE}/api/risk-flags`, {
    method: "POST", headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({
      contract_id: ctId, category: "termination", title: "Short notice",
      explanation: "Notice period below playbook floor.", severity: "medium",
      recommended_step: "Negotiate 90 days."
    })
  });
  const rf = await rfRes.json() as { id: string };
  if (!rf.id) throw new Error(`risk flag create failed: ${JSON.stringify(rf)}`);

  // Dedicated target for cross-workspace probes (never deleted by the matrix).
  const ct2Res = await fetch(`${BASE}/api/contracts`, {
    method: "POST", headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ title: "RBAC Cross-WS Target" })
  });
  const ct2 = await ct2Res.json() as { contract_id: string };

  /* ── 4. Matrix ── */
  const matrix: { action: string; method: string; destructive?: boolean; path: () => string; body?: unknown; allowed: (r: Role) => number }[] = [
    { action: "contract.create", method: "POST", path: () => "/api/contracts", body: { title: "X" }, allowed: (r) => (canEdit(r) ? 201 : 403) },
    { action: "contract.edit", method: "PATCH", path: () => `/api/contracts/${ctId}`, body: { title: "RBAC Test MSA v2" }, allowed: (r) => (canEdit(r) ? 200 : 403) },
    { action: "contract.delete", method: "DELETE", destructive: true, path: () => `/api/contracts/${ctId}`, allowed: (r) => (isAdmin(r) ? 204 : 403) },
    { action: "obligation.create", method: "POST", path: () => `/api/contracts/${ctId}/obligations`, body: { title: "T", obligor: "A", obligee: "B", due_rule: "fixed", due_rule_detail: { date: "2026-12-01" } }, allowed: (r) => (canEdit(r) ? 201 : 403) },
    { action: "obligation.edit", method: "PATCH", path: () => `/api/obligations/${ob.id}`, body: { action: "edit", priority: "low" }, allowed: (r) => (canEdit(r) ? 200 : 403) },
    { action: "obligation.delete", method: "DELETE", destructive: true, path: () => `/api/obligations/${ob.id}`, allowed: (r) => (isAdmin(r) ? 204 : 403) },
    { action: "risk.create", method: "POST", path: () => "/api/risk-flags", body: { contract_id: ctId, category: "payment", title: "T", explanation: "E", severity: "low", recommended_step: "S" }, allowed: (r) => (canEdit(r) ? 201 : 403) },
    { action: "risk.decide", method: "POST", path: () => `/api/risk-flags/${rf.id}/decisions`, body: { decision: "not_a_risk", note: "rbac test" }, allowed: (r) => (canDecide(r) ? 201 : 403) },
    { action: "risk.reopen", method: "POST", path: () => `/api/risk-flags/${rf.id}`, body: { note: "rbac reopen" }, allowed: (r) => (canDecide(r) ? 200 : 403) },
    { action: "risk.delete", method: "DELETE", destructive: true, path: () => `/api/risk-flags/${rf.id}`, allowed: (r) => (isAdmin(r) ? 204 : 403) },
    { action: "member.invite", method: "POST", path: () => `/api/workspaces/${wsId}/members`, body: { email: `x-${Date.now()}@test.example`, role: "viewer" }, allowed: (r) => (isAdmin(r) ? 201 : 403) },
    { action: "member.role_change", method: "PATCH", path: () => `/api/workspaces/${wsId}/members`, body: { user_id: userIds.viewer, role: "contributor" }, allowed: (r) => (isAdmin(r) ? 200 : 403) },
    { action: "member.remove", method: "DELETE", destructive: true, path: () => `/api/workspaces/${wsId}/members?user_id=${userIds.viewer}`, allowed: (r) => (isAdmin(r) ? 204 : 403) }
  ];

  // Pass 1: every non-destructive action × every role (targets intact).
  for (const m of matrix.filter((m) => !m.destructive)) {
    for (const role of ROLES) {
      const want = m.allowed(role);
      const got = await call(jar[role]!, m.method, m.path(), m.body);
      results.push({ action: m.action, role, want, got, ok: want === got });
    }
  }
  // Pass 2: destructive actions, admin LAST (reversed roles) so all 403 probes
  // still have targets. Order matters: member.remove must run after the other
  // destructive cells (it would strip roles needed for their 403 probes), and
  // contract.delete cascades obligations/risk flags, so it runs after theirs.
  const destructiveOrder = ["risk.delete", "obligation.delete", "contract.delete", "member.remove"];
  for (const name of destructiveOrder) {
    const m = matrix.find((x) => x.action === name)!;
    for (const role of [...ROLES].reverse()) {
      const want = m.allowed(role);
      const got = await call(jar[role]!, m.method, m.path(), m.body);
      results.push({ action: m.action, role, want, got, ok: want === got });
    }
  }

  /* ── 5. Cross-workspace: 404, never 403 ── */
  const crossCells: { action: string; got: number }[] = [];
  for (const [method, path] of [
    ["GET", `/api/contracts/${ct2.contract_id}`],
    ["PATCH", `/api/contracts/${ct2.contract_id}`],
    ["GET", `/api/obligations/${ob.id}`]
  ] as const) {
    void rf.id;
    const got = await call(outsiderCookie, method, path, method === "PATCH" ? { title: "x" } : undefined);
    crossCells.push({ action: `cross-workspace ${method}`, got });
    results.push({ action: `cross-workspace ${method}`, role: "external_signer", want: 404, got, ok: got === 404 });
  }

  /* ── 6. Audit trail written for authorized mutations ── */
  const auditRes = await fetch(`${BASE}/api/audit-events?limit=200`, { headers: { cookie: admin } });
  const auditBody = await res2json(auditRes);
  const actions = new Set<string>((auditBody.data ?? []).map((a: { action: string }) => a.action));
  for (const expected of ["contract.create", "obligation.create", "risk.create", "member.role_change", "risk.decide"]) {
    results.push({ action: `audit.${expected}`, role: "workspace_admin", want: 1, got: actions.has(expected) ? 1 : 0, ok: actions.has(expected) });
  }

  /* ── 7. Report ── */
  const failures = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.action.padEnd(22)} ${r.role.padEnd(16)} want=${r.want} got=${r.got}`);
  }
  console.log(`\n${results.length - failures.length}/${results.length} passed`);
  if (failures.length > 0) process.exitCode = 1;

  /* ── 8. Cleanup ── */
  await db.delete(workspaces).where(inArray(workspaces.id, [wsId, ws2Id]));
  // Audit rows are append-only and reference actors; detach before deleting.
  await db.execute(sql`UPDATE audit_events SET actor_user_id = NULL WHERE actor_user_id = ANY(${sql.raw(`ARRAY['${[...Object.values(userIds), outsiderId].join("','")}']::text[]`)})`);
  await db.delete(users).where(inArray(users.id, [...Object.values(userIds), outsiderId]));
  await pool.end();
}

async function res2json(res: Response): Promise<{ data?: { action: string }[] }> {
  try { return await res.json(); } catch { return {}; }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
