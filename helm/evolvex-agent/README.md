# evolvex-agent Helm chart

Cluster-side agent for Evolvex — forwards Kubernetes warning events to the Evolvex API webhook and ships an OTel collector ConfigMap.

## Install from GHCR (production — no repo clone)

Published on every push to `main` when this chart changes:

```bash
helm upgrade --install evolvex-agent oci://ghcr.io/ishaansatapathy/evolvex-agent \
  --version 0.1.0 \
  --namespace evolvex \
  --create-namespace \
  --set evolvex.baseUrl=https://evolvex-api.ishaandev.co.in \
  --set evolvex.webhookSecret=<from-settings> \
  --set evolvex.organizationId=<from-settings> \
  --set cluster.name=production
```

Or copy the full command from **Settings → Connect Kubernetes** in the Evolvex app (org-scoped secret and values are filled in automatically).

> Make the `evolvex-agent` package **public** under GitHub → Packages so installs work without `helm registry login`.

## Install from repo (local dev)

```bash
helm upgrade --install evolvex-agent ./helm/evolvex-agent \
  --namespace evolvex \
  --create-namespace \
  --set evolvex.baseUrl=http://localhost:8000 \
  ...
```

## Uninstall

```bash
helm uninstall evolvex-agent --namespace evolvex
```
