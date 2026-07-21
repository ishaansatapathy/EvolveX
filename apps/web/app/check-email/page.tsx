"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import "../signin/signin.css";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email")?.trim() || "your inbox";

  return (
    <main className="evx-auth">
      <img src="/images/landing-background.png" alt="" aria-hidden className="evx-auth__bg" />
      <div className="evx-auth__scrim" aria-hidden />

      <Link href="/" className="evx-auth__brand">
        <span className="evx-auth__brand-evolve">EVOLVE</span>
        <span className="evx-auth__brand-x">X</span>
      </Link>

      <div className="evx-auth__card">
        <span className="evx-auth__tape evx-auth__tape--left" aria-hidden />
        <span className="evx-auth__tape evx-auth__tape--right" aria-hidden />

        <p className="evx-auth__kicker">⊙ VERIFY YOUR IDENTITY</p>
        <h1 className="evx-auth__title">Check your email</h1>
        <p className="evx-auth__sub">
          We sent a verification link to <strong>{email}</strong>. Open it to finish setting up Evolvex.
        </p>

        <Link href="/signin" className="evx-auth__submit" style={{ textAlign: "center", textDecoration: "none" }}>
          BACK TO SIGN IN →
        </Link>
      </div>

      <p className="evx-auth__footnote">Every incident leaves evidence.</p>
    </main>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailContent />
    </Suspense>
  );
}
