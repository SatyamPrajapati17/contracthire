"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FaceScan, isFaceEnrolled } from "@/components/face-scan";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [mailInfo, setMailInfo] = useState<{ provider: string; delivered: boolean; error?: string } | null>(null);
  const [faceOpen, setFaceOpen] = useState(false);
  const params = useSearchParams();
  const expired = params.get("error") === "expired";
  const signedOut = params.get("signedout") === "1";
  const faceReady = email.includes("@") && isFaceEnrolled(email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setDevUrl(body.dev_url ?? null);
      setMailInfo({ provider: body.email_provider ?? "console", delivered: !!body.email_delivered, error: body.email_error });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full" style={{ maxWidth: 560 }}>
        <div className="flex items-baseline gap-3 mb-8">
          <span className="font-serif text-2xl text-ink">ContractLens</span>
          <span className="text-xs text-smoke">contract intelligence, cited</span>
        </div>

        {expired && (
          <p className="text-critical text-xs mb-4" role="alert">Link expired. Request a new one below.</p>
        )}

        {state !== "sent" ? (
          <form onSubmit={submit} aria-label="Sign in">
            <label htmlFor="email" className="block text-xs text-graphite mb-2">Work email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-ash rounded-input px-4 py-3 text-sm bg-surface mb-4"
              placeholder="you@company.example"
              aria-describedby="email-note"
            />
            <p id="email-note" className="text-xs text-smoke mb-6">
              We send a one-time sign-in link. No password needed.
            </p>
            <button
              type="submit"
              disabled={state === "sending"}
              className="w-full rounded-pill bg-lake text-white text-sm py-3 hover:bg-lake-hover disabled:bg-periwinkle disabled:text-graphite disabled:cursor-not-allowed"
            >
              {state === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {state === "error" && (
              <p className="text-critical text-xs mt-3" role="alert">Could not send the link. Try again.</p>
            )}
            <div className="flex items-center gap-3 my-5" aria-hidden>
              <span className="flex-1 border-t border-ash-soft" />
              <span className="text-xs text-smoke">or</span>
              <span className="flex-1 border-t border-ash-soft" />
            </div>
            <a
              href="/api/auth/signin-google"
              className="w-full rounded-pill border border-ash text-sm py-3 flex items-center justify-center gap-2 hover:border-periwinkle-deep"
            >
              <span aria-hidden className="font-medium">G</span> Continue with Google
            </a>
            <button
              type="button"
              onClick={() => setFaceOpen(true)}
              disabled={!faceReady}
              title={faceReady ? "Sign in with your face" : "Enroll your face first (Settings → Security, or sign in once by email)"}
              className="w-full rounded-pill border border-ash text-sm py-3 flex items-center justify-center gap-2 hover:border-periwinkle-deep disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span aria-hidden>◍</span> Sign in with face
            </button>
          </form>
        ) : (
          <div aria-live="polite">
            {mailInfo?.delivered ? (
              <>
                <h3 className="mb-2">Check your inbox</h3>
                <p className="text-sm text-graphite mb-6">
                  A one-time sign-in link was emailed to <span className="text-offblack">{email}</span>. It expires in 15 minutes.
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-2">Your sign-in link is ready</h3>
                <p className="text-sm text-graphite mb-4">
                  {mailInfo?.error
                    ? "Email delivery is not configured on this machine, so the link is right here:"
                    : "Local dev mode — no email is sent. Open your one-time link below (also printed in the server console):"}
                </p>
                {devUrl && (
                  <a
                    href={devUrl}
                    className="w-full rounded-pill bg-lake text-white text-sm py-3 mb-3 flex items-center justify-center gap-2 hover:bg-lake-hover transition-colors min-h-11 font-medium"
                  >
                    Sign in as {email} →
                  </a>
                )}
              </>
            )}
            {devUrl && mailInfo?.delivered && (
              <div className="panel p-4 mb-4">
                <p className="text-xs text-smoke mb-2">Or open the link directly (dev):</p>
                <a href={devUrl} className="text-info text-xs break-all underline">{devUrl}</a>
              </div>
            )}
            <p className="text-xs text-smoke mb-6">The link works once and expires in 15 minutes.</p>
            <button
              onClick={() => setState("idle")}
              className="rounded-pill border border-ash px-6 py-2 text-sm hover:border-periwinkle-deep"
            >
              Use a different email
            </button>
          </div>
        )}

        <p className="text-xs text-smoke mt-10 border-t border-ash-soft pt-4">
          AI assistance tool, not legal advice. Verify before relying.
        </p>
      </div>

      {faceOpen && (
        <FaceScan
          email={email}
          mode="verify"
          onSuccess={async () => {
            const res = await fetch("/api/auth/face", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email })
            });
            const body = await res.json() as { redirect?: string; error?: { message?: string } };
            if (res.ok && body.redirect) {
              window.location.href = body.redirect;
            } else {
              setFaceOpen(false);
              setState("error");
            }
          }}
          onCancel={() => setFaceOpen(false)}
        />
      )}
    </main>
  );
}
