import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PROBLEMS = [
  { n: "P1", pain: "Contracts are read once and never again", evidence: "Renewals auto-trigger because nobody tracked the 60-day notice window." },
  { n: "P2", pain: "Obligations are buried in prose", evidence: "\u201cVendor shall provide monthly uptime reports\u201d is never enforced — discovered during a dispute." },
  { n: "P3", pain: "Key terms live in people's heads", evidence: "A contract owner leaves; institutional memory leaves with them." },
  { n: "P4", pain: "Version negotiation loses track of what changed", evidence: "The counterparty returns v4 with a quietly widened liability cap." },
  { n: "P5", pain: "Legal review is a queue, not a service", evidence: "Business teams wait days for a yes/no on a standard NDA." },
  { n: "P6", pain: "Generic AI tools hallucinate contract terms", evidence: "An LLM confidently invents a termination clause that does not exist. This is the problem every design decision here answers." }
];

const AGENTS = [
  { id: "A1", name: "Intake", line: "file bytes → doc type, counterparty, language" },
  { id: "A2", name: "Parse & OCR", line: "per-page text with char offsets; tesseract.js below 100 chars" },
  { id: "A3", name: "Segment", line: "clause tree — section refs, titles, spans" },
  { id: "A4", name: "Extract", line: "29 fields, each re-read against the source before it survives" },
  { id: "A5", name: "Obligations", line: "returns due-date rules; code does the math, never the model" },
  { id: "A6", name: "Risk & playbook", line: "flags vs your rules — no citation, no flag" },
  { id: "A7", name: "Diff", line: "clause alignment across versions, graded by materiality" },
  { id: "A8", name: "Retrieval", line: "answers only from chunks your role may see, with citations" },
  { id: "A9", name: "Brief", line: "four-band summary, every sentence mapped to a field ID" },
  { id: "A10", name: "Notification", line: "90/30/14/7/1-day alerts, idempotent, never double-sends" },
  { id: "A11", name: "Human review", line: "your corrections recompute everything downstream" }
];

const FAQS = [
  {
    q: "How is this different from asking an LLM to read my contract?",
    a: "A chatbot generates text and hopes it is right. ContractLens inverts that: every fact is a structured claim bound to exact character offsets in the document, and a validator re-reads the source slice before anything reaches you. Below the similarity bar, the claim is dropped and shown as not_found — you see the gap instead of a confident invention."
  },
  {
    q: "What can go wrong, and what happens then?",
    a: "Extraction is schema-validated with one bounded repair retry. Dates are computed by code from the rule the model returns — never by the model. If the anchor date is unknown, the obligation enters needs_assumption and waits for you. Every field can be corrected, and dependent values recompute automatically."
  },
  {
    q: "Who can see what?",
    a: "Role-based permissions are enforced server-side on every route, not just hidden in the UI. Cross-workspace resources return 404 — existence is never disclosed. Every mutating action is written to an append-only audit log with actor, action, and before/after."
  },
  {
    q: "Is this legal advice?",
    a: "No. A banned-phrase lint runs on every user-facing AI output, and there is no legal-advice field in the schema. ContractLens organizes facts, obligations, and risks with citations — a human decides."
  }
];

const DEMO_FACTS = [
  { label: "Payment terms", value: "Net 45", conf: "0.94" },
  { label: "Late fee", value: "1.5% / month", conf: "0.92" },
  { label: "Termination notice", value: "60 days", conf: "0.95" }
];

export default async function Home() {
  const ctx = await getCtx();
  if (ctx?.workspaceId) {
    const mem = await db.select().from(memberships).where(eq(memberships.userId, ctx.userId)).limit(1);
    if (mem[0] || ctx.workspaceId) {
      const wsId = mem[0]?.workspaceId ?? ctx.workspaceId;
      return <meta httpEquiv="refresh" content={`0;url=/w/${wsId}/dashboard`} />;
    }
  }

  return (
    <main className="min-h-screen bg-parchment text-offblack overflow-x-clip">
      {/* Announcement bar */}
      <div className="w-full bg-ink text-parchment text-xs" style={{ letterSpacing: "-0.025em" }}>
        <div className="max-w-content mx-auto px-6 h-10 flex items-center justify-between gap-4">
          <p className="truncate uppercase tracking-wide">
            Every fact carries a citation to the exact sentence it came from — or it says not_found
          </p>
          <Link href="/signin" className="hidden sm:inline-flex shrink-0 rounded-pill border border-parchment/70 px-4 py-1 text-[11px] uppercase tracking-widest hover:bg-parchment hover:text-ink transition-colors">
            Try the demo
          </Link>
        </div>
      </div>

      {/* Nav */}
      <header className="w-full">
        <div className="max-w-content mx-auto px-6 h-20 flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-lake" aria-hidden />
            <span className="font-serif text-xl">ContractLens</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-[13px] uppercase" style={{ letterSpacing: "-0.02em" }} aria-label="Main">
            <a href="#problem" className="hover:text-lake transition-colors">Problem</a>
            <a href="#how" className="hover:text-lake transition-colors">How it works</a>
            <a href="#agents" className="hover:text-lake transition-colors">Agents</a>
            <a href="#trust" className="hover:text-lake transition-colors">Trust</a>
            <a href="#faq" className="hover:text-lake transition-colors">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/signin" className="hidden sm:inline-flex rounded-pill border border-offblack px-5 h-11 items-center text-xs uppercase tracking-widest hover:bg-surface transition-colors">
              Sign in
            </Link>
            <Link href="/signin" className="inline-flex rounded-pill bg-lake text-white px-6 h-11 items-center text-xs uppercase tracking-widest hover:bg-lake-hover transition-colors gap-2">
              Get started <span aria-hidden>▸</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — pure typographic, with soft washes behind */}
      <section className="relative" aria-label="Hero">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-[70%] w-[560px] h-[560px] rounded-full opacity-40 blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(255,148,115,0.55), rgba(160,181,235,0.4) 55%, transparent 75%)" }} />
          <div className="absolute top-24 right-[-120px] w-[520px] h-[520px] rounded-full opacity-40 blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(167,252,205,0.5), rgba(160,181,235,0.45) 55%, transparent 75%)" }} />
        </div>

        <div className="relative max-w-content mx-auto px-6 pt-20 pb-16 text-center">
          <p className="text-xs uppercase text-smoke mb-5" style={{ letterSpacing: "0.08em" }}>
            Agentic contract intelligence · every fact cited
          </p>
          <h1 className="font-serif text-[44px] leading-[1.1] sm:text-6xl md:text-7xl lg:text-[80px] lg:leading-[1.15] text-offblack" style={{ letterSpacing: "-0.02em" }}>
            A missed 60-day renewal<br className="hidden sm:block" /> notice on page 14<br className="hidden sm:block" /> costs five figures.
          </h1>
          <p className="text-graphite text-base sm:text-lg md:text-xl mt-7 max-w-2xl mx-auto leading-relaxed">
            ContractLens reads every contract like a lawyer would — with citations. Each fact links to the
            exact sentence it came from, and anything it cannot verify, it reports <em>not_found</em> instead of guessing.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mt-9">
            <Link href="/signin" className="inline-flex w-full sm:w-auto rounded-pill bg-lake text-white px-8 h-12 items-center justify-center text-sm uppercase tracking-widest hover:bg-lake-hover transition-colors gap-2">
              Try the demo <span aria-hidden>▸</span>
            </Link>
            <Link href="/signin" className="inline-flex w-full sm:w-auto rounded-pill border border-offblack px-8 h-12 items-center justify-center text-sm uppercase tracking-widest text-offblack hover:bg-surface transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Demo evidence strip — real brief values */}
      <section className="max-w-content mx-auto px-6 pb-20" aria-label="Example extracted facts">
        <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {DEMO_FACTS.map((f) => (
            <div key={f.label} className="rounded-card border border-ash bg-surface p-6 card-enter transition-transform duration-200 hover:-translate-y-0.5">
              <p className="text-[11px] uppercase text-smoke mb-2">{f.label}</p>
              <p className="font-serif text-2xl text-offblack">{f.value}</p>
              <p className="text-xs text-success mt-3">confidence {f.conf} · cited</p>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-smoke mt-5">
          Live values from the seeded Northwind MSA demo — every one resolvable to its source page, section and characters.
        </p>
      </section>

      {/* Problem */}
      <section id="problem" className="max-w-content mx-auto px-6 py-16 border-t border-ash-soft scroll-mt-6">
        <p className="text-xs uppercase text-smoke mb-3">The problem</p>
        <h2 className="font-serif text-3xl md:text-4xl mb-10" style={{ letterSpacing: "-0.02em" }}>
          Six ways contracts quietly cost companies money
        </h2>
        <div className="grid md:grid-cols-2 gap-5">
          {PROBLEMS.map((p) => (
            <div key={p.n} className="rounded-card border border-ash bg-surface p-7 card-enter transition-colors hover:border-periwinkle-deep">
              <p className="text-xs text-lake mb-3">{p.n}</p>
              <h3 className="font-serif text-xl mb-2">{p.pain}</h3>
              <p className="text-sm text-graphite leading-relaxed">{p.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works + pipeline diagram */}
      <section id="how" className="max-w-content mx-auto px-6 py-16 border-t border-ash-soft scroll-mt-6">
        <p className="text-xs uppercase text-smoke mb-3">How it works</p>
        <h2 className="font-serif text-3xl md:text-4xl mb-10" style={{ letterSpacing: "-0.02em" }}>
          The golden path, in one pass
        </h2>

        {/* Pipeline: pill nodes connected by curved lines (SVG), like the Monad diagram */}
        <div className="rounded-card border border-ash bg-surface p-6 sm:p-10 overflow-x-auto">
          <svg viewBox="0 0 1120 190" className="min-w-[880px] w-full h-auto" role="img" aria-label="Pipeline diagram: upload through parse, extract and obligations to brief, risk, alerts and Q&A">
            <defs>
              <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" fill="#a0b5eb" />
              </marker>
              <radialGradient id="hub" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(167,252,205,0.55)" />
                <stop offset="100%" stopColor="rgba(167,252,205,0)" />
              </radialGradient>
            </defs>

            {/* connector curves */}
            <path d="M 150 62 C 195 62, 200 62, 240 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 355 62 C 400 62, 405 62, 445 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 565 62 C 605 62, 610 62, 650 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 55 100 C 55 140, 120 148, 190 148" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 55 100 C 55 40, 120 32, 190 32" fill="none" stroke="#a0b5eb" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#arr)" />

            {/* soft green hub glow under extract */}
            <circle cx="500" cy="62" r="72" fill="url(#hub)" />

            {/* row 1: main flow */}
            {[
              { x: 20, label: "Upload" },
              { x: 245, label: "Parse · OCR" },
              { x: 450, label: "Extract" },
              { x: 655, label: "Obligations" },
              { x: 860, label: "Brief" }
            ].map((n) => (
              <g key={n.label}>
                <rect x={n.x} y={40} rx="18" ry="18" width={n.x === 860 ? 210 : 110} height={44}
                  fill="#f6f3f1" stroke="#cecac8" />
                <text x={n.x + (n.x === 860 ? 105 : 55)} y={66} textAnchor="middle"
                  fontFamily="ui-monospace, Menlo, monospace" fontSize="13" fill="#242424">{n.label}</text>
              </g>
            ))}
            {/* arrows inside row 1 */}
            <path d="M 135 62 C 180 62, 195 62, 240 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 360 62 C 405 62, 420 62, 445 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 565 62 C 610 62, 625 62, 650 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <path d="M 870 62 C 915 62, 925 62, 955 62" fill="none" stroke="#a0b5eb" strokeWidth="1.5" markerEnd="url(#arr)" />
            <g>
              <rect x={960} y={40} rx="18" ry="18" width={140} height={44} fill="#f6f3f1" stroke="#cecac8" />
              <text x={1030} y={66} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="13" fill="#242424">Risk decision</text>
            </g>

            {/* row 2: side outcomes */}
            <g>
              <rect x={190} y={126} rx="18" ry="18" width={175} height={44} fill="#cfdaf5" stroke="transparent" />
              <text x={277} y={152} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="13" fill="#242424">Grounded Q&A</text>
            </g>
            <g>
              <rect x={420} y={126} rx="18" ry="18" width={130} height={44} fill="#cfdaf5" stroke="transparent" />
              <text x={485} y={152} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="13" fill="#242424">Alerts</text>
            </g>
            <g>
              <rect x={620} y={126} rx="18" ry="18" width={175} height={44} fill="#cfdaf5" stroke="transparent" />
              <text x={707} y={152} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="13" fill="#242424">Sheets sync</text>
            </g>
          </svg>
        </div>

        <ol className="flex flex-wrap gap-2.5 items-center mt-8">
          {["Upload", "Cited brief", "Obligations", "Grounded Q&A", "Version diff", "Risk decision", "Alert"].map((s, i) => (
            <li key={s} className="flex items-center gap-2.5">
              <span className="rounded-pill border border-ash bg-surface px-4 py-2 text-xs uppercase">{i + 1}. {s}</span>
              {i < 6 && <span aria-hidden className="text-sky text-sm">→</span>}
            </li>
          ))}
        </ol>
      </section>

      {/* Agents */}
      <section id="agents" className="max-w-content mx-auto px-6 py-16 border-t border-ash-soft scroll-mt-6">
        <p className="text-xs uppercase text-smoke mb-3">Why agents, not a chatbot</p>
        <h2 className="font-serif text-3xl md:text-4xl mb-4" style={{ letterSpacing: "-0.02em" }}>
          Eleven specialists, each validated before hand-off
        </h2>
        <p className="text-sm text-graphite mb-10 max-w-2xl">
          One LLM call cannot be audited. A pipeline can: every agent has its own schema, its own validation,
          and its own record — model, prompt version, latency, outcome — on the Agent activity page.
        </p>

        <div className="grid md:grid-cols-3 gap-5">
          {/* Elevated periwinkle card leads the grid */}
          <div className="md:col-span-2 rounded-card bg-periwinkle p-8 relative overflow-hidden">
            <div aria-hidden className="absolute right-[-60px] top-[-60px] w-[300px] h-[300px] rounded-full opacity-50 blur-[60px]"
              style={{ background: "linear-gradient(135deg, rgba(255,148,115,0.6), rgba(160,181,235,0.6) 50%, rgba(167,252,205,0.6))" }} />
            <p className="text-xs uppercase text-graphite mb-3">The pipeline</p>
            <h3 className="font-serif text-2xl mb-2">Agentic by construction</h3>
            <p className="text-sm text-graphite max-w-md leading-relaxed">
              Each agent's output is schema-validated with Zod, citation-checked against the document, and
              rejected — loudly — when it fails. The activity page shows exactly what ran.
            </p>
          </div>
          {AGENTS.map((a) => (
            <div key={a.id} className="rounded-card border border-ash bg-surface p-6 transition-colors hover:border-periwinkle-deep">
              <p className="text-xs text-lake mb-2">{a.id}</p>
              <h3 className="font-serif text-lg mb-1.5">{a.name}</h3>
              <p className="text-xs text-graphite leading-relaxed">{a.line}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="max-w-content mx-auto px-6 py-16 border-t border-ash-soft scroll-mt-6">
        <p className="text-xs uppercase text-smoke mb-3">Trust, built in</p>
        <h2 className="font-serif text-3xl md:text-4xl mb-10" style={{ letterSpacing: "-0.02em" }}>
          The model proposes. The validator disposes.
        </h2>
        <div className="grid md:grid-cols-3 gap-5">
          <div className="rounded-card border border-ash bg-surface p-7">
            <span className="inline-block text-[11px] uppercase px-3 py-1 rounded-pill bg-lake-tint text-lake border border-periwinkle-deep mb-4">citation</span>
            <p className="font-serif text-lg mb-2">&ldquo;within forty-five (45) days&rdquo;</p>
            <p className="text-xs text-smoke mb-3">p.1 §2 · chars 412–446</p>
            <p className="text-sm text-graphite">Every fact links to the exact sentence it came from. Click it and the viewer scrolls there and highlights the text.</p>
          </div>
          <div className="rounded-card border border-ash bg-surface p-7">
            <span className="inline-block text-[11px] uppercase px-3 py-1 rounded-pill bg-medium-bg text-medium border border-ash mb-4">not_found</span>
            <p className="font-serif text-lg mb-2">It says &ldquo;not found&rdquo;, out loud</p>
            <p className="text-sm text-graphite">When the document does not state a term, ContractLens does not fill the blank. A claim that fails verification is dropped — never replaced by a plausible invention.</p>
          </div>
          <div className="rounded-card border border-ash bg-surface p-7">
            <span className="inline-block text-[11px] uppercase px-3 py-1 rounded-pill bg-success-bg text-success border border-ash mb-4">confidence 0.94</span>
            <p className="font-serif text-lg mb-2">A number you can interrogate</p>
            <p className="text-sm text-graphite">Each fact carries a blended confidence: the model&rsquo;s own claim re-scored against the actual source text it cites.</p>
          </div>
        </div>
      </section>

      {/* FAQ — serif questions, hairline rows, chevrons */}
      <section id="faq" className="max-w-content mx-auto px-6 py-16 border-t border-ash-soft scroll-mt-6">
        <p className="text-xs uppercase text-smoke mb-3">FAQ</p>
        <h2 className="font-serif text-3xl md:text-4xl mb-10" style={{ letterSpacing: "-0.02em" }}>
          Straight answers
        </h2>
        <div>
          {FAQS.map((f, i) => (
            <details key={f.q} className="group border-b border-ash-soft" open={i === 0}>
              <summary className="flex items-center justify-between gap-6 py-7 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="font-serif text-lg md:text-xl text-offblack">{f.q}</span>
                <span aria-hidden className="text-offblack text-xl transition-transform duration-200 group-open:rotate-180">↓</span>
              </summary>
              <p className="text-sm text-graphite leading-relaxed pb-7 max-w-3xl">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative overflow-hidden" aria-label="Get started">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-140px] bottom-[-160px] w-[480px] h-[480px] rounded-full opacity-35 blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(255,148,115,0.5), rgba(160,181,235,0.4) 55%, transparent 75%)" }} />
        </div>
        <div className="relative max-w-content mx-auto px-6 py-24 text-center">
          <h2 className="font-serif text-3xl md:text-5xl mb-6" style={{ letterSpacing: "-0.02em" }}>
            Read the Northwind MSA with us
          </h2>
          <p className="text-sm text-graphite mb-9 max-w-xl mx-auto">
            The demo workspace is seeded with a real two-version MSA — brief, obligations, risk flags, diff, and
            a working Q&A. No signup friction: pick a persona, get a link, sign in.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/signin" className="inline-flex w-full sm:w-auto rounded-pill bg-lake text-white px-8 h-12 items-center justify-center text-sm uppercase tracking-widest hover:bg-lake-hover transition-colors gap-2">
              Try the demo <span aria-hidden>▸</span>
            </Link>
            <Link href="/signin" className="inline-flex w-full sm:w-auto rounded-pill border border-offblack px-8 h-12 items-center justify-center text-sm uppercase tracking-widest hover:bg-surface transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Footer disclaimer */}
      <footer className="border-t border-ash-soft py-10">
        <div className="max-w-content mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-lake" aria-hidden />
            <span className="font-serif text-base">ContractLens</span>
          </div>
          <p className="text-xs text-smoke text-center">AI assistance. Verify before relying. This is not legal advice.</p>
          <p className="text-xs text-smoke">localhost demo · seeded data</p>
        </div>
      </footer>
    </main>
  );
}
