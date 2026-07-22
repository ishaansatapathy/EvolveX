"use client";

import { useRouter } from "next/navigation";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { useEvolvexUser } from "~/hooks/use-evolvex-user";
import { trpc } from "~/trpc/client";

export default function SettingsPage() {
  const router = useRouter();
  const { data: user } = useEvolvexUser();
  const logoutMutation = trpc.auth.logout.useMutation();
  const utils = trpc.useUtils();
  const signozStatus = trpc.investigations.signozStatus.useQuery({});

  async function handleSignOut() {
    await logoutMutation.mutateAsync({});
    await utils.auth.me.invalidate();
    router.push("/signin");
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
          <p className="evx-dash__settings-label">SIGNOZ CLOUD</p>
          <p className="evx-dash__settings-value">
            {signozStatus.data?.apiConfigured ? "API connected" : "Not configured"}
          </p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Cloud URL: {signozStatus.data?.cloudUrl ?? "Set SIGNOZ_CLOUD_URL in .env"}
          </p>
          <p className="evx-dash__stat-note">
            Webhook URL: {signozStatus.data?.webhookUrl ?? "—"}
          </p>
          <p className="evx-dash__stat-note">
            Webhook auth: {signozStatus.data?.webhookAuthConfigured ? "Enabled" : "Optional (SIGNOZ_WEBHOOK_SECRET)"}
          </p>
          <p className="evx-dash__stat-note">
            Ingestion: {signozStatus.data?.ingestionConfigured ? "Configured" : "Set SIGNOZ_INGESTION_KEY"}
          </p>
          <p className="evx-dash__stat-note">
            Default service: {signozStatus.data?.defaultServiceName ?? "payments-svc"}
          </p>
          <p className="evx-dash__stat-note">
            Mode: {signozStatus.data?.productionMode ? "Production" : "Development"}
            {signozStatus.data?.demoTracesEnabled ? " · demo traces on" : ""}
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">WORKSPACE</p>
          <p className="evx-dash__settings-value">Evolvex Production</p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Environment: PROD · Region: auto
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
