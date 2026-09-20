export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-block mt-2 rounded-pill bg-sunk px-3 h-6 text-xs leading-6 text-graphite">
      {role.replace(/_/g, " ")}
    </span>
  );
}
