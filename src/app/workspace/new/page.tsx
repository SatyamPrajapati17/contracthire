"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewWorkspace() {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Europe/London");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("contributor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, timezone })
      });
      if (!res.ok) throw new Error("create failed");
      const { workspace_id } = await res.json();
      if (inviteEmail.trim()) {
        await fetch(`/api/workspaces/${workspace_id}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole })
        }).catch(() => undefined);
      }
      router.push(`/w/${workspace_id}/dashboard`);
    } catch {
      setError("Could not create the workspace. Try again.");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full" style={{ maxWidth: 560 }}>
        <h2 className="mb-2">Create your workspace</h2>
        <p className="text-sm text-graphite mb-8">A workspace holds your contracts, team, and playbook.</p>
        <form onSubmit={submit}>
          <label htmlFor="ws-name" className="block text-xs text-graphite mb-2">Workspace name</label>
          <input id="ws-name" required value={name} onChange={(e) => setName(e.target.value)}
            className="w-full border border-ash rounded-input px-4 py-3 text-sm bg-surface mb-4"
            placeholder="Harbourline Foods" />
          <label htmlFor="ws-tz" className="block text-xs text-graphite mb-2">Timezone</label>
          <select id="ws-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="w-full border border-ash rounded-input px-4 py-3 text-sm bg-surface mb-4">
            <option>Europe/London</option>
            <option>Europe/Berlin</option>
            <option>America/New_York</option>
            <option>UTC</option>
          </select>
          <p className="text-xs text-smoke mb-2">Invite a teammate (optional — they can sign in with their email)</p>
          <div className="flex gap-2 mb-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email"
              className="flex-1 border border-ash rounded-input px-4 py-3 text-sm bg-surface" placeholder="mira@company.example" />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
              className="border border-ash rounded-input px-3 py-3 text-sm bg-surface"
              aria-label="Invite role">
              <option value="contributor">Contributor</option>
              <option value="legal_reviewer">Legal reviewer</option>
              <option value="viewer">Viewer</option>
              <option value="contract_owner">Contract owner</option>
            </select>
          </div>
          {error && <p className="text-critical text-xs mt-2" role="alert">{error}</p>}
          <button type="submit" disabled={busy}
            className="mt-6 w-full rounded-pill bg-lake text-white text-sm py-3 hover:bg-lake-hover disabled:bg-periwinkle disabled:text-graphite">
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </div>
    </main>
  );
}
