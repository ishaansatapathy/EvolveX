"use client";

import { useMemo, useState } from "react";

import { trpc } from "~/trpc/client";

type PluginsPanelProps = {
  organizationId?: string;
  isOwner: boolean;
};

export function PluginsPanel({ organizationId, isOwner }: PluginsPanelProps) {
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const catalogQuery = trpc.plugins.catalog.useQuery(undefined, { enabled: isOwner });
  const installationsQuery = trpc.plugins.installations.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) && isOwner },
  );
  const sdkStatusQuery = trpc.plugins.sdkStatus.useQuery(undefined, { enabled: isOwner });

  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: async (result) => {
      setRevealedSecret(result.webhookSecret);
      await utils.plugins.installations.invalidate();
      await utils.integrations.health.invalidate();
    },
  });

  const toggleMutation = trpc.plugins.setEnabled.useMutation({
    onSuccess: async () => {
      await utils.plugins.installations.invalidate();
    },
  });

  const removeMutation = trpc.plugins.remove.useMutation({
    onSuccess: async () => {
      await utils.plugins.installations.invalidate();
    },
  });

  const installedByPluginId = useMemo(() => {
    return new Map((installationsQuery.data ?? []).map((row) => [row.pluginId, row]));
  }, [installationsQuery.data]);

  if (!isOwner) {
    return (
      <section className="evx-dash__settings-card" style={{ marginTop: "1rem" }}>
        <p className="evx-dash__settings-label">PLUGINS · #58</p>
        <p className="evx-dash__stat-note">Only workspace owners can install plugins.</p>
      </section>
    );
  }

  return (
    <section className="evx-dash__settings-card evx-plugins__panel" style={{ marginTop: "1rem" }}>
      <p className="evx-dash__settings-label">PLUGIN MARKETPLACE · #58</p>
      <p className="evx-dash__stat-note" style={{ marginBottom: "0.75rem" }}>
        Install third-party importers and custom event plugins. Each install gets a unique webhook secret.
      </p>

      {sdkStatusQuery.data ? (
        <p className="evx-dash__stat-note" style={{ marginBottom: "0.75rem" }}>
          SDK API (#57): <code>{sdkStatusQuery.data.baseUrl}</code>
          {sdkStatusQuery.data.configured ? " · configured" : " · set EVOLVEX_API_KEY in .env"}
        </p>
      ) : null}

      {revealedSecret ? (
        <div className="evx-plugins__secret-banner">
          <p className="evx-dash__ti-label">Webhook secret (copy now)</p>
          <code>{revealedSecret}</code>
          <button type="button" className="evx-dash__btn-ghost" onClick={() => void navigator.clipboard.writeText(revealedSecret)}>
            Copy secret
          </button>
        </div>
      ) : null}

      <div className="evx-plugins__grid">
        {(catalogQuery.data ?? []).map((plugin) => {
          const installed = installedByPluginId.get(plugin.id);
          return (
            <article key={plugin.id} className="evx-plugins__card">
              <div className="evx-plugins__card-head">
                <p className="evx-plugins__card-title">{plugin.name}</p>
                <span className="evx-dash__chip">{plugin.category}</span>
              </div>
              <p className="evx-dash__stat-note">{plugin.description}</p>
              <p className="evx-dash__stat-note">v{plugin.version} · {plugin.hooks.join(", ")}</p>
              {installed ? (
                <>
                  <p className="evx-dash__stat-note">
                    Webhook: <code>{installed.webhookUrl}</code>
                  </p>
                  <div className="evx-dash__cause-actions" style={{ marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      className="evx-dash__btn-ghost"
                      disabled={toggleMutation.isPending}
                      onClick={() =>
                        void toggleMutation.mutateAsync({
                          organizationId,
                          pluginId: plugin.id,
                          enabled: !installed.enabled,
                        })
                      }
                    >
                      {installed.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="evx-dash__btn-ghost"
                      disabled={removeMutation.isPending}
                      onClick={() => void removeMutation.mutateAsync({ organizationId, pluginId: plugin.id })}
                    >
                      Uninstall
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="evx-dash__btn-primary"
                  style={{ marginTop: "0.55rem" }}
                  disabled={!organizationId || installMutation.isPending}
                  onClick={() => void installMutation.mutateAsync({ organizationId, pluginId: plugin.id })}
                >
                  Install plugin
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
