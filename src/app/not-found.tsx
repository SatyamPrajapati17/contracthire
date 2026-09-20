import Link from "next/link";

/** Themed 404 — parchment, serif, with a way out. */
export default function NotFound() {
  return (
    <main id="main" className="min-h-screen bg-parchment text-offblack flex items-center justify-center p-6">
      <div className="card w-full" style={{ maxWidth: 560 }}>
        <p className="text-xs uppercase text-smoke mb-3">404</p>
        <h1 className="font-serif text-2xl mb-3">This page does not exist</h1>
        <p className="text-sm text-graphite mb-7">
          The link may be truncated — workspace URLs need <code className="text-xs">/dashboard</code> at the end.
        </p>
        <div className="flex gap-3">
          <Link href="/" className="rounded-pill bg-lake text-white px-6 py-2.5 text-sm hover:bg-lake-hover transition-colors">
            Go home
          </Link>
          <Link href="/signin" className="rounded-pill border border-ash px-6 py-2.5 text-sm hover:border-periwinkle-deep transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
