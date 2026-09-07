import { NextResponse } from "next/server";
import { catalogHireNetwork, catalogHireWritesEnabled } from "@/src/mainnet/catalog-hire-network";
import { CatalogErc8183Repository } from "@/src/mainnet/catalog-erc8183-repository";
import { CatalogHireUnavailableError, resolveCatalogHireTarget } from "@/src/mainnet/catalog-hire";
import { NotifyFundedJob } from "@/src/business/use-cases/notify-funded-job";
import { assertExpectedJob } from "@/src/business/policies/erc8183-spike-policy";
import { notificationStore } from "@/src/mainnet/hire-notification-store";
import { processHireNotification } from "@/src/mainnet/hire-notification-recovery";
import type { HireNotification } from "@/shared/hire-notification";
import { Erc8183SpikeDisabledError, InvalidErc8183SpikeInputError } from "@/src/business/errors/erc8183-spike-errors";
import { erc8183SpikeErrorResponse, spikeAddress, spikeJobId, spikeJsonBody } from "@/src/presentation/http/erc8183-spike-http";

function requestId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidErc8183SpikeInputError("quoteRequestId must be a positive request id");
  return value;
}

function response(error: unknown, chainId: 56 | 97): NextResponse {
  if (error instanceof CatalogHireUnavailableError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 409 });
  }
  return erc8183SpikeErrorResponse(error, chainId === 97 ? "Testnet" : "Mainnet");
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  let chainId: 56 | 97 = 56;
  try {
    chainId = catalogHireNetwork(request);
    const { agentId } = await context.params;
    const body = await spikeJsonBody(request);
    const target = await resolveCatalogHireTarget(agentId, requestId(body.quoteRequestId), { allowExpired: true, chainId });
    const repository = new CatalogErc8183Repository(target);
    const job = await repository.getJob(BigInt(spikeJobId(body.jobId)));
    if (job.status === "SUBMITTED" || job.status === "COMPLETED") {
      return NextResponse.json({ acknowledged: true, alreadySubmitted: true, job }, { headers: { "cache-control": "no-store" } });
    }
    if (!catalogHireWritesEnabled(chainId)) throw new Erc8183SpikeDisabledError();
    if (process.env.HIRE_NOTIFICATION_RECOVERY_ENABLED === "1") {
      const buyer = spikeAddress(body.buyer, "buyer");
      assertExpectedJob(job, { buyer, seller: target.provider, allowlist: repository.allowlist });
      if (job.status !== "FUNDED") throw new InvalidErc8183SpikeInputError("Notification requires a funded job");
      await notificationStore({ action: "enqueue", chainId, jobId: job.jobId, agentId, quoteRequestId: requestId(body.quoteRequestId), buyer });
      const recovered = await processHireNotification(chainId, job.jobId);
      if (recovered?.result) return NextResponse.json(recovered.result, { headers: { "cache-control": "no-store" } });
      const saved = await notificationStore<HireNotification>({ action: "read", chainId, jobId: job.jobId });
      if (["notified", "watching", "delivered"].includes(saved.state)) return NextResponse.json({ acknowledged: true, alreadySubmitted: saved.state === "delivered", job }, { headers: { "cache-control": "no-store" } });
      return NextResponse.json({ error: { code: "NOTIFICATION_PENDING", message: "Funding is confirmed. Check this job's notification status; do not fund again." } }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(await (new NotifyFundedJob(repository)).execute({
      buyer: spikeAddress(body.buyer, "buyer"),
      jobId: spikeJobId(body.jobId),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) { return response(error, chainId); }
}
