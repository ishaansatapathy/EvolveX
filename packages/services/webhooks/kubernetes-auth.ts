import type { Request, Response } from "express";

import {
  resolveKubernetesWebhookSecret,
  resolveOrganizationIdForKubernetesWebhook,
} from "../organization/integrations";
import { requireWebhookSecret } from "./verify";

export async function requireKubernetesWebhookAuth(
  req: Request,
  res: Response,
): Promise<{ ok: true; organizationId: string | null } | { ok: false }> {
  const headerOrgId = req.headers["x-evolvex-org-id"];
  const providedSecret = req.headers["x-evolvex-k8s-secret"];
  const secret = typeof providedSecret === "string" ? providedSecret.trim() : "";

  if (secret) {
    const orgFromSecret = await resolveOrganizationIdForKubernetesWebhook(secret);
    if (orgFromSecret) {
      return { ok: true, organizationId: orgFromSecret };
    }

    const envSecret = process.env.KUBERNETES_WEBHOOK_SECRET?.trim();
    if (envSecret && secret === envSecret) {
      const orgId = typeof headerOrgId === "string" ? headerOrgId : null;
      return { ok: true, organizationId: orgId };
    }

    res.status(401).json({ error: "Invalid Kubernetes webhook secret" });
    return { ok: false };
  }

  const orgId = typeof headerOrgId === "string" ? headerOrgId : null;
  if (orgId) {
    const expected = await resolveKubernetesWebhookSecret(orgId);
    if (expected && secret === expected) {
      return { ok: true, organizationId: orgId };
    }
  }

  const legacyOk = requireWebhookSecret(req, res, "KUBERNETES_WEBHOOK_SECRET", "x-evolvex-k8s-secret");
  if (!legacyOk) return { ok: false };

  return { ok: true, organizationId: orgId };
}
