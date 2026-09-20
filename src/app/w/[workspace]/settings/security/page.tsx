"use client";

import { useEffect, useState } from "react";
import { FaceScan, isFaceEnrolled, clearFaceEnrollment } from "@/components/face-scan";

export default function SecurityPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [modal, setModal] = useState<"none" | "enroll" | "verify">("none");
  const [enrolled, setEnrolled] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { email?: string } | null) => {
        if (b?.email) {
          setEmail(b.email);
          setEnrolled(isFaceEnrolled(b.email));
        }
        setLoaded(true);
      });
  }, []);

  async function signOutAfterClear() {
    if (email) clearFaceEnrollment(email);
    setEnrolled(false);
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Security</h1>
        <p className="text-sm opacity-70 mt-1">
          Face verification for signing and sign-in. The template lives only in this browser
          (128-float descriptor, never uploaded) and is removed when you clear it.
        </p>
      </header>

      {!loaded ? (
        <p className="text-sm opacity-60">Loading…</p>
      ) : !email ? (
        <p className="text-sm">Sign in to manage face verification.</p>
      ) : (
        <section className="border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Face verification</h2>
              <p className="text-sm opacity-70">
                {enrolled ? "Enrolled on this device." : "Not enrolled on this device yet."}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${enrolled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "opacity-60"}`}>
              {enrolled ? "enrolled" : "none"}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => setModal("enroll")}
              className="rounded-pill bg-lake text-white px-4 py-2 text-sm hover:bg-lake-hover transition-colors">
              {enrolled ? "Re-enroll face" : "Enroll face"}
            </button>
            {enrolled && (
              <>
                <button onClick={() => { setModal("verify"); setVerified(false); }}
                  className="rounded-pill border px-4 py-2 text-sm hover:bg-lake-tint">
                  Test verification
                </button>
                <button onClick={signOutAfterClear}
                  className="rounded-pill border border-red-200 text-red-700 px-4 py-2 text-sm hover:bg-red-50">
                  Remove template
                </button>
              </>
            )}
          </div>

          {verified && (
            <p className="text-sm text-emerald-700">✓ Verification passed — face sign-in and face-signed documents are enabled on this device.</p>
          )}
        </section>
      )}

      {modal !== "none" && email && (
        <FaceScan
          email={email}
          mode={modal === "enroll" ? "enroll" : "verify"}
          onSuccess={() => {
            setModal("none");
            if (modal === "enroll") setEnrolled(true);
            else setVerified(true);
          }}
          onCancel={() => setModal("none")}
        />
      )}
    </div>
  );
}
