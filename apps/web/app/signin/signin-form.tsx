"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TRPCClientError } from "@trpc/client";

import { trpc } from "~/trpc/client";
import "./signin.css";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 10) issues.push("at least 10 characters");
  if (!/[a-z]/.test(password)) issues.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("an uppercase letter");
  if (!/\d/.test(password)) issues.push("a number");
  return issues;
}

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [twoFactorEmail, setTwoFactorEmail] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const signInMutation = trpc.auth.signIn.useMutation();
  const signUpMutation = trpc.auth.signUp.useMutation();
  const verify2FAMutation = trpc.auth.verify2FA.useMutation();
  const demoSignInMutation = trpc.auth.demoSignIn.useMutation();

  const loading =
    signInMutation.isPending ||
    signUpMutation.isPending ||
    verify2FAMutation.isPending ||
    demoSignInMutation.isPending;

  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) setError(decodeURIComponent(urlError));
  }, [searchParams]);

  function trpcMessage(err: unknown) {
    if (err instanceof TRPCClientError) return err.message;
    if (err instanceof Error) return err.message;
    return "Something went wrong. Try again.";
  }

  async function finishLogin() {
    await utils.auth.me.invalidate();
    router.push("/dashboard");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    if (twoFactorEmail) {
      if (otp.length !== 6) {
        setError("Enter the 6-digit verification code.");
        return;
      }
      try {
        await verify2FAMutation.mutateAsync({ email: twoFactorEmail, otp });
        await finishLogin();
      } catch (err) {
        setError(trpcMessage(err));
      }
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        setError("Enter your name.");
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
        const result = await signUpMutation.mutateAsync({
          fullName: name.trim(),
          email: email.trim(),
          password,
          confirmPassword,
        });
        router.push(`/check-email?email=${encodeURIComponent(result.email ?? email.trim())}`);
      } catch (err) {
        setError(trpcMessage(err));
      }
      return;
    }

    if (!password) {
      setError("Password is required.");
      return;
    }

    try {
      const result = await signInMutation.mutateAsync({ email: email.trim(), password });
      if (result.twoFactorRequired) {
        setTwoFactorEmail(result.email);
        setSuccess(result.message);
        return;
      }
      await finishLogin();
    } catch (err) {
      setError(trpcMessage(err));
    }
  }

  function handleGoogle() {
    window.location.href = `/api-auth/google?state=${encodeURIComponent("/dashboard")}`;
  }

  async function handleDemoLogin() {
    setError("");
    try {
      const result = await demoSignInMutation.mutateAsync({});
      if (result.twoFactorRequired) {
        setTwoFactorEmail(result.email);
        setSuccess(result.message);
        return;
      }
      await finishLogin();
    } catch (err) {
      setError(trpcMessage(err));
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

        <p className="evx-auth__kicker">⊙ CASE FILE ACCESS</p>
        <h1 className="evx-auth__title">
          {twoFactorEmail
            ? "Enter verification code"
            : mode === "signin"
              ? "Welcome back, detective."
              : "Join the investigation."}
        </h1>
        <p className="evx-auth__sub">
          {twoFactorEmail
            ? `We sent a code to ${twoFactorEmail}.`
            : mode === "signin"
              ? "Sign in to reopen your investigations."
              : "Create an account and start following the evidence."}
        </p>

        {!twoFactorEmail ? (
          <button
            type="button"
            suppressHydrationWarning
            className="evx-auth__google"
            onClick={handleGoogle}
            disabled={loading}
          >
            <GoogleIcon />
            Continue with Google
          </button>
        ) : null}

        {!twoFactorEmail ? (
          <>
            <button
              type="button"
              suppressHydrationWarning
              className="evx-auth__google"
              onClick={handleDemoLogin}
              disabled={loading}
              style={{ marginTop: "0.5rem", opacity: 0.92 }}
            >
              Demo login (judges)
            </button>
            <p className="evx-auth__switch" style={{ marginTop: "0.35rem", fontSize: "0.68rem" }}>
              Requires DEMO_LOGIN_ENABLED on the API.
            </p>
          </>
        ) : null}

        {!twoFactorEmail ? (
          <div className="evx-auth__divider">
            <span>or with email</span>
          </div>
        ) : null}

        <form className="evx-auth__form" onSubmit={handleSubmit}>
          {twoFactorEmail ? (
            <label className="evx-auth__field">
              <span>Verification code</span>
              <input
                type="text"
                inputMode="numeric"
                suppressHydrationWarning
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoComplete="one-time-code"
              />
            </label>
          ) : null}

          {mode === "signup" && !twoFactorEmail ? (
            <label className="evx-auth__field">
              <span>Name</span>
              <input
                type="text"
                suppressHydrationWarning
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sherlock Holmes"
                autoComplete="name"
              />
            </label>
          ) : null}

          {!twoFactorEmail ? (
            <>
              <label className="evx-auth__field">
                <span>Email</span>
                <input
                  type="email"
                  suppressHydrationWarning
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>

              <label className="evx-auth__field">
                <span>Password</span>
                <input
                  type="password"
                  suppressHydrationWarning
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </label>

              {mode === "signup" ? (
                <label className="evx-auth__field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    suppressHydrationWarning
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </label>
              ) : (
                <p className="evx-auth__switch" style={{ marginTop: "-0.25rem" }}>
                  <Link href="/forgot-password" style={{ color: "inherit" }}>
                    Forgot password?
                  </Link>
                </p>
              )}
            </>
          ) : null}

          {error ? <p className="evx-auth__error">✕ {error}</p> : null}
          {success ? <p className="evx-auth__success">{success}</p> : null}

          <button type="submit" suppressHydrationWarning className="evx-auth__submit" disabled={loading}>
            {loading
              ? "OPENING CASE FILE…"
              : twoFactorEmail
                ? "VERIFY CODE →"
                : mode === "signin"
                  ? "SIGN IN →"
                  : "CREATE ACCOUNT →"}
          </button>
        </form>

        {!twoFactorEmail ? (
          <p className="evx-auth__switch">
            {mode === "signin" ? (
              <>
                No account?{" "}
                <button type="button" suppressHydrationWarning onClick={() => setMode("signup")}>
                  Sign up free
                </button>
              </>
            ) : (
              <>
                Already investigating?{" "}
                <button type="button" suppressHydrationWarning onClick={() => setMode("signin")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        ) : null}
      </div>

      <p className="evx-auth__footnote">Every incident leaves evidence.</p>
    </main>
  );
}
