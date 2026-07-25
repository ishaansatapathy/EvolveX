"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppPageHeader } from "~/components/evolvex/app-shell";
import { AuditLogPanel } from "~/components/evolvex/audit-log-panel";
import { IntegrationHealthPanel } from "~/components/evolvex/integration-health-panel";
import { IntegrationsEcosystemPanel } from "~/components/evolvex/integrations-ecosystem-panel";
import { KubernetesOnboardingPanel } from "~/components/evolvex/kubernetes-onboarding-panel";
import { OrganizationIntegrationsPanel } from "~/components/evolvex/organization-integrations-panel";
import { ProductionEngineeringPanel } from "~/components/evolvex/production-engineering-panel";
import { PluginsPanel } from "~/components/evolvex/plugins-panel";
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
  const healthQuery = trpc.integrations.health.useQuery({});
  const signozTest = trpc.integrations.testSignoz.useQuery({}, { enabled: false });
  const databaseTest = trpc.integrations.testDatabase.useQuery({}, { enabled: false });
  const githubTest = trpc.integrations.testGithub.useQuery({}, { enabled: false });
  const openAiTest = trpc.integrations.testOpenAi.useQuery({}, { enabled: false });
  const auditQuery = trpc.audit.list.useQuery({ limit: 50 }, { enabled: user?.role === "admin" });
  const organizationsQuery = trpc.organizations.list.useQuery({}, { enabled: Boolean(user) });
  const updateOrganization = trpc.organizations.update.useMutation({
    onSuccess: async () => {
      await utils.organizations.list.invalidate();
    },
  });
  const [workspaceName, setWorkspaceName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function handleSignOut() {
    await logoutMutation.mutateAsync({});
    await utils.auth.me.invalidate();
    router.push("/signin");
  }

  async function handleCopy(id: string, value: string) {
    await copyText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function handleTest(id: string) {
    setTestingId(id);

    try {
      let result:
        | { ok: boolean; message: string }
        | undefined;

      if (id === "signoz_api") {
        result = (await signozTest.refetch()).data;
      } else if (id === "database") {
        result = (await databaseTest.refetch()).data;
        await healthQuery.refetch();
      } else if (id === "github_api") {
        result = (await githubTest.refetch()).data;
      } else if (id === "openai") {
        result = (await openAiTest.refetch()).data;
      }

      alert(result?.ok ? result.message : result?.message ?? "Connection test failed");
    } finally {
      setTestingId(null);
    }
  }

  if (!user) return null;

  const health = healthQuery.data;
  const workspace = organizationsQuery.data?.[0];
  const isWorkspaceOwner = workspace?.role === "owner";

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
            Email verified: {user.emailVerified ? "Yes" : "No"} · 2FA: {user.twoFactorEnabled ? "On" : "Off"} · Role:{" "}
            {user.role}
          </p>
        </article>

        <article className="evx-dash__settings-card">
          <p className="evx-dash__settings-label">WORKSPACE</p>
          <p className="evx-dash__settings-value">
            {organizationsQuery.data?.[0]?.name ?? `${user.fullName}'s workspace`}
          </p>
          <p className="evx-dash__stat-note" style={{ marginTop: "0.4rem" }}>
            Slug: {organizationsQuery.data?.[0]?.slug ?? "pending"} · Workspace role:{" "}
            {organizationsQuery.data?.[0]?.role ?? "member"} · Platform role: {user.role}
          </p>
          {isWorkspaceOwner ? (
            <div className="evx-dash__org-field" style={{ marginTop: "0.75rem" }}>
              <label>
                <span className="evx-dash__stat-note">Rename workspace (#33)</span>
                <input
                  type="text"
                  placeholder={workspace?.name ?? "Workspace name"}
                  value={workspaceName || workspace?.name || ""}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
              <div className="evx-dash__cause-actions" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="evx-dash__btn-ghost"
                  disabled={!workspace?.id || updateOrganization.isPending}
                  onClick={async () => {
                    if (!workspace?.id) return;
                    const name = (workspaceName || workspace.name).trim();
                    if (!name) return;
                    await updateOrganization.mutateAsync({ organizationId: workspace.id, name });
                    setWorkspaceName("");
                  }}
                >
                  {updateOrganization.isPending ? "Saving…" : "Save workspace name"}
                </button>
              </div>
            </div>
          ) : null}
          <p className="evx-dash__stat-note">
            Mode: {health?.productionMode ? "Production" : "Development"}
          </p>
          <p className="evx-dash__stat-note">
            Owners can connect SigNoz, GitHub, Slack, and PagerDuty per workspace. Secrets are encrypted at rest.
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

      <OrganizationIntegrationsPanel
        organizationId={workspace?.id}
        organizationName={workspace?.name}
        isOwner={isWorkspaceOwner}
        baseUrl={health?.baseUrl}
      />

      <KubernetesOnboardingPanel organizationId={workspace?.id} isOwner={isWorkspaceOwner} />

      <PluginsPanel organizationId={workspace?.id} isOwner={isWorkspaceOwner} />

      {healthQuery.isLoading ? (
        <p className="evx-dash__stat-note" style={{ marginTop: "1rem" }}>
          Loading integration health…
        </p>
      ) : health ? (
        <IntegrationHealthPanel
          readyCount={health.readyCount}
          partialCount={health.partialCount}
          missingCount={health.missingCount}
          totalCount={health.totalCount}
          summary={health.summary}
          productionMode={health.productionMode}
          defaultServiceName={health.defaultServiceName}
          cloudUrl={health.cloudUrl}
          integrations={health.integrations}
          copiedId={copiedId}
          testingId={testingId}
          onCopy={handleCopy}
          onTest={handleTest}
        />
      ) : (
        <p className="evx-dash__stat-note" style={{ marginTop: "1rem" }}>
          Could not load integration health. Check API logs.
        </p>
      )}

      <IntegrationsEcosystemPanel />

      <ProductionEngineeringPanel />

      {user.role === "admin" ? (
        <div style={{ marginTop: "1rem" }}>
          <AuditLogPanel events={auditQuery.data ?? []} loading={auditQuery.isLoading} title="Workspace audit log" />
        </div>
      ) : null}
    </>
  );
}
