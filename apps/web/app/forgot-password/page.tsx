"use client";

import Link from "next/link";
import { useState } from "react";
import { TRPCClientError } from "@trpc/client";

import { trpc } from "~/trpc/client";
import "../signin/signin.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const forgotMutation = trpc.auth.forgotPassword.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    try {
      const result = await forgotMutation.mutateAsync({
        email: email.trim(),
        method: "link",
      });
      setSuccess(result.message);
    } catch (err) {
      if (err instanceof TRPCClientError) {
        setError(err.message);
      } else {
        setError("Unable to send reset email. Try again.");
      }
    }
  }

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

        <p className="evx-auth__kicker">⊙ RECOVER ACCESS</p>
        <h1 className="evx-auth__title">Forgot password?</h1>
        <p className="evx-auth__sub">We&apos;ll email you a link to reset your password.</p>

        <form className="evx-auth__form" onSubmit={handleSubmit}>
          <label className="evx-auth__field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </label>

          {error ? <p className="evx-auth__error">✕ {error}</p> : null}
          {success ? <p className="evx-auth__success">{success}</p> : null}

          <button type="submit" className="evx-auth__submit" disabled={forgotMutation.isPending}>
            {forgotMutation.isPending ? "SENDING…" : "SEND RESET LINK →"}
          </button>
        </form>

        <p className="evx-auth__switch">
          Remember your password?{" "}
          <Link href="/signin" style={{ color: "inherit" }}>
            Sign in
          </Link>
        </p>
      </div>

      <p className="evx-auth__footnote">Every incident leaves evidence.</p>
    </main>
  );
}
