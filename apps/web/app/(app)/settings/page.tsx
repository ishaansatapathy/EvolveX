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

  const status = signozStatus.data;

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
          <p className="evx-dash__settings-value">{status?.apiConfigured ? "API configured" : "Not configured"}</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Cloud URL: {status?.cloudUrl ?? "Set SIGNOZ_CLOUD_URL in .env"}
          </p>
          <p className="evx-dash__stat-note">Default service: {status?.defaultServiceName ?? "payments-svc"}</p>
          <p className="evx-dash__stat-note">
            Ingestion: {status?.ingestionConfigured ? "Configured (OTel active)" : "Set SIGNOZ_INGESTION_KEY"}
          </p>
          <p className="evx-dash__stat-note">Alert webhook: {status?.webhookUrl ?? "—"}</p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            <button type="button" className="evx-dash__btn-primary" onClick={handleTestSignoz}>
              Test SigNoz API
            </button>
            {status?.webhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-ghost"
                onClick={() => handleCopy("signoz", status.webhookUrl)}
              >
                {copied === "signoz" ? "Copied!" : "Copy alert webhook"}
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · OPENAI</p>
          <p className="evx-dash__settings-value">
            {status?.openAiConfigured ? "Configured" : "Not configured"}
          </p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Generates root-cause markdown from real timeline evidence only. No summary is fabricated when the key is
            missing.
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · GITHUB</p>
          <p className="evx-dash__settings-value">Deploy correlation</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Webhook URL: {status?.githubWebhookUrl ?? "—"}
          </p>
          <p className="evx-dash__stat-note">Event: push · verified via X-Hub-Signature-256</p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            {status?.githubWebhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-primary"
                onClick={() => handleCopy("github", status.githubWebhookUrl)}
              >
                {copied === "github" ? "Copied!" : "Copy GitHub webhook"}
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · KUBERNETES</p>
          <p className="evx-dash__settings-value">Cluster change events</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Webhook URL: {status?.kubernetesWebhookUrl ?? "—"}
          </p>
          <p className="evx-dash__stat-note">Point kubernetes-event-exporter or ArgoCD notifications here.</p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            {status?.kubernetesWebhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-primary"
                onClick={() => handleCopy("k8s", status.kubernetesWebhookUrl)}
              >
                {copied === "k8s" ? "Copied!" : "Copy K8s webhook"}
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">CONNECTIONS · EBPF</p>
          <p className="evx-dash__settings-value">Kernel signals</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Webhook URL: {status?.ebpfWebhookUrl ?? "—"}
          </p>
          <p className="evx-dash__stat-note">
            Real paths: OpenTelemetry eBPF Instrumentation (OBI) → SigNoz OTLP, Cilium Hubble / Pixie webhook,
            or <code style={{ fontSize: "0.65rem" }}>pnpm obi:bridge</code> anomaly bridge. No synthetic kernel
            evidence is generated.
          </p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.35rem" }}>
            OBI demo: <code style={{ fontSize: "0.65rem" }}>pnpm obi:up</code> (Docker Linux). See docs/EBPF-OBI.md.
          </p>
          <div className="evx-dash__cause-actions" style={{ marginTop: "0.9rem" }}>
            {status?.ebpfWebhookUrl ? (
              <button
                type="button"
                className="evx-dash__btn-primary"
                onClick={() => handleCopy("ebpf", status.ebpfWebhookUrl)}
              >
                {copied === "ebpf" ? "Copied!" : "Copy eBPF webhook"}
              </button>
            ) : null}
          </div>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">WORKSPACE</p>
          <p className="evx-dash__settings-value">{user.fullName}&apos;s workspace</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Mode: {status?.productionMode ? "Production" : "Development"}
          </p>
          <p className="evx-dash__stat-note">
            Self-instrumentation: {status?.otelApiEnabled ? "evolvex-api + evolvex-web → SigNoz" : "Set ingestion key"}
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
