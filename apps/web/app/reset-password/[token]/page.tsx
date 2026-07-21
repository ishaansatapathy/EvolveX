"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TRPCClientError } from "@trpc/client";

import { trpc } from "~/trpc/client";
import "../../signin/signin.css";

function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 10) issues.push("at least 10 characters");
  if (!/[a-z]/.test(password)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("an uppercase letter");
  if (!/\d/.test(password)) issues.push("a number");
  return issues;
}

function ResetPasswordForm() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const email = searchParams.get("email")?.trim() ?? "";
  const token = params.token?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const resetMutation = trpc.auth.resetPassword.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email || !token) {
      setError("Invalid reset link.");
      return;
    }

    const issues = passwordIssues(password);
    if (issues.length) {
      setError(`Password needs ${issues.join(", ")}.`);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      const result = await resetMutation.mutateAsync({
        email,
        newPassword: password,
        token,
      });
      setSuccess(result.message);
      setTimeout(() => router.push("/signin"), 1500);
    } catch (err) {
      if (err instanceof TRPCClientError) {
        setError(err.message);
      } else {
        setError("Unable to reset password. Try requesting a new link.");
      }
    }
  }

  if (!email || !token) {
    return (
      <main className="evx-auth">
        <img src="/images/landing-background.png" alt="" aria-hidden className="evx-auth__bg" />
        <div className="evx-auth__scrim" aria-hidden />
        <Link href="/" className="evx-auth__brand">
          <span className="evx-auth__brand-evolve">EVOLVE</span>
          <span className="evx-auth__brand-x">X</span>
        </Link>
        <div className="evx-auth__card">
          <p className="evx-auth__error">✕ Invalid reset link.</p>
          <Link href="/signin" className="evx-auth__submit" style={{ textAlign: "center", textDecoration: "none" }}>
            BACK TO SIGN IN →
          </Link>
        </div>
      </main>
    );
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

        <p className="evx-auth__kicker">⊙ NEW CREDENTIALS</p>
        <h1 className="evx-auth__title">Reset your password</h1>
        <p className="evx-auth__sub">Choose a new password for {email}.</p>

        <form className="evx-auth__form" onSubmit={handleSubmit}>
          <label className="evx-auth__field">
            <span>New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </label>

          <label className="evx-auth__field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </label>

          {error ? <p className="evx-auth__error">✕ {error}</p> : null}
          {success ? <p className="evx-auth__success">{success}</p> : null}

          <button type="submit" className="evx-auth__submit" disabled={resetMutation.isPending}>
            {resetMutation.isPending ? "UPDATING…" : "UPDATE PASSWORD →"}
          </button>
        </form>
      </div>

      <p className="evx-auth__footnote">Every incident leaves evidence.</p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
