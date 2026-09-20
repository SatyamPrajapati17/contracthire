import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export default function SignIn() {
  return (
    <Suspense fallback={<main id="main" className="min-h-screen flex items-center justify-center p-6"><div className="card w-full" style={{ maxWidth: 560 }} /></main>}>
      <SignInForm />
    </Suspense>
  );
}
