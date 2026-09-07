import "server-only";
import { getAddress } from "viem";
import type { HireNotification } from "../../shared/hire-notification.ts";
import { recoverHireNotification } from "../business/use-cases/recover-hire-notification.ts";
import { notificationStore } from "../data/observation/hire-notification-store.ts";
import { assertExpectedJob } from "../business/policies/erc8183-spike-policy.ts";
import { CatalogErc8183Repository } from "./catalog-erc8183-repository.ts";
import { resolveCatalogHireTarget } from "./catalog-hire.ts";
import { catalogHireWritesEnabled } from "./catalog-hire-network.ts";

export async function processHireNotification(chainId: 56 | 97, jobId: string) {
  if (process.env.HIRE_NOTIFICATION_RECOVERY_ENABLED !== "1" || !catalogHireWritesEnabled(chainId)) return null;
  const key = { chainId, jobId };
  return recoverHireNotification({
    now: Date.now,
    claim: () => notificationStore<HireNotification | null>({ action: "claim", ...key }),
    prepare: async row => {
      const target = await resolveCatalogHireTarget(row.agentId, row.quoteRequestId, { chainId, allowExpired: true });
      const repo = new CatalogErc8183Repository(target);
      const job = await repo.getJob(BigInt(jobId));
      // Closed/expired states are reconciled without another external notification.
      if (!["REJECTED", "EXPIRED"].includes(job.status) && BigInt(job.deadline) > BigInt(Math.floor(Date.now()/1000))) {
        assertExpectedJob(job, { buyer: getAddress(row.buyer), seller: target.provider, allowlist: repo.allowlist });
      }
      return { job, notify: (beforeSend) => repo.notifyFunded(BigInt(jobId), beforeSend) };
    },
    sending: async row => { await notificationStore({ action: "sending", ...key, token: row.leaseToken }); },
    finish: async (row, state) => { await notificationStore({ action: "finish", ...key, token: row.leaseToken, state }); },
  });
}
