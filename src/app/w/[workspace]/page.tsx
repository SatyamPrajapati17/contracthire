import { redirect } from "next/navigation";

/** Bare workspace URL → dashboard (avoids a 404 when /dashboard is dropped). */
export default async function WorkspaceIndex({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/w/${workspace}/dashboard`);
}
