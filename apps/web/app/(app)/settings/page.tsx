"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { useEvolvexUser } from "~/hooks/use-evolvex-user";
import { trpc } from "~/trpc/client";

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export default function SettingsPage() {
  const router = useRouter();
  const { data: user } = useEvolvexUser();
  const logoutMutation = trpc.auth.logout.useMutation();
  const utils = trpc.useUtils();
  const signozStatus = trpc.investigations.signozStatus.useQuery({});
  const signozTest = trpc.investigations.testSignozConnection.useQuery({}, { enabled: false });
  const [copied, setCopied] = useState<string | null>(null);

  async function handleSignOut() {
    await logoutMutation.mutateAsync({});
    await utils.auth.me.invalidate();
    router.push("/signin");
  }

  async function handleCopy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function handleTestSignoz() {
    const result = await signozTest.refetch();
    if (result.data?.ok) {
      alert(result.data.message);
    } else {
      alert(result.data?.message ?? "SigNoz connection failed");
    }
  }

  if (!user) return null;

  return (
    <>
      <AppPageHeader kicker="⊙ WORKSPACE CONFIG" title="Settings" />

      <section className="evx-dash__settings-grid">
        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">PROFILE</p>
          <p className="evx-dash__settings-value">{user.fullName}</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            {user.email}
          </p>
          <p className="evx-dash__stat-note">
            Email verified: {user.emailVerified ? "Yes" : "No"} · 2FA: {user.twoFactorEnabled ? "On" : "Off"}
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · SIGNOZ</p>
          <p className="evx-dash__settings-value">
            {signozStatus.data?.apiConfigured ? "API configured" : "Not configured"}
          </p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Cloud URL: {signozStatus.data?.cloudUrl ?? "Set SIGNOZ_CLOUD_URL in .env"}
          </p>
          <p className="evx-dash__stat-note">
            Default service: {signozStatus.data?.defaultServiceName ?? "payments-svc"}
          </p>
          <p className="evx-dash__stat-note">
            Ingestion: {signozStatus.data?.ingestionConfigured ? "Configured" : "Set SIGNOZ_INGESTION_KEY"}
          </p>
          <p className="evx-dash__stat-note">
            Alert webhook: {signozStatus.data?.webhookUrl ?? "—"}
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            <button type="button" className="evx-dash__btn-primary" onClick={handleTestSignoz}>
              Test SigNoz API
            </button>
            {signozStatus.data?.webhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={() => handleCopy("signoz", signozStatus.data!.webhookUrl)}
              >
                {copied === "signoz" ? "Copied!" : "Copy alert webhook"}
              </button>
            ) : null}
          </div>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.75rem" }}>
            SigNoz computes p95/p99 and fires alerts. Evolvex investigates — set a p99 latency alert in SigNoz pointing to this webhook.
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · GITHUB</p>
          <p className="evx-dash__settings-value">Deploy correlation</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Webhook URL: {signozStatus.data?.githubWebhookUrl ?? "—"}
          </p>
          <p className="evx-dash__stat-note">
            Event: <code>push</code> · adds DEPLOY timeline entries to open investigations
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            {signozStatus.data?.githubWebhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-primary"
                onClick={() => handleCopy("github", signozStatus.data!.githubWebhookUrl)}
              >
                {copied === "github" ? "Copied!" : "Copy GitHub webhook"}
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · EBPF</p>
          <p className="evx-dash__settings-value">Kernel context enricher</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Auto-attached on p99 / tail-latency investigations (TCP retransmit, connect latency, pool pressure).
          </p>
          <p className="evx-dash__stat-note">
            Production path: Grafana Beyla or OTel eBPF → SigNoz ingest → Evolvex investigates alert.
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">WORKSPACE</p>
          <p className="evx-dash__settings-value">{user.fullName}&apos;s workspace</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Mode: {signozStatus.data?.productionMode ? "Production" : "Development"}
            {signozStatus.data?.demoTracesEnabled ? " · demo traces on" : ""}
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            <button type="button" className="evx-dash__btn-primary" onClick={() => router.push("/investigations")}>
              Go to Investigations →
            </button>
            <button type="button" className="evx-dash__btn-ghost" onClick={handleSignOut} disabled={logoutMutation.isPending}>
              Sign out
            </button>
          </div>
        </article>
      </section>
    </>
  );
}
