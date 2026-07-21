"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TRPCClientError } from "@trpc/client";

import { trpc } from "~/trpc/client";
import "../../signin/signin.css";

export default function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const verifyMutation = trpc.auth.verifyEmail.useMutation();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    const token = params.token?.trim();
    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link.");
      return;
    }

    let cancelled = false;

    verifyMutation
      .mutateAsync({ token })
      .then(async () => {
        if (cancelled) return;
        await utils.auth.me.invalidate();
        setStatus("success");
        setMessage("Email verified. Redirecting to your dashboard…");
        router.replace("/dashboard");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        if (err instanceof TRPCClientError) {
          setMessage(err.message);
        } else {
          setMessage("This verification link is invalid or has expired.");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

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

        <p className="evx-auth__kicker">⊙ EMAIL VERIFICATION</p>
        <h1 className="evx-auth__title">
          {status === "loading" ? "Hold tight…" : status === "success" ? "You're verified" : "Link expired"}
        </h1>
        <p className={`evx-auth__sub ${status === "error" ? "evx-auth__error" : ""}`}>{message}</p>

        {status === "error" ? (
          <Link href="/signin" className="evx-auth__submit" style={{ textAlign: "center", textDecoration: "none" }}>
            BACK TO SIGN IN →
          </Link>
        ) : null}
      </div>

      <p className="evx-auth__footnote">Every incident leaves evidence.</p>
    </main>
  );
}
