import type { D1DatabaseLike } from "../db/client";
import { D1AgentIdentityRepository } from "../identity/repository";
import { IDENTITY_BATCH_LIMIT, type IdentityChainId, type JobIdentityBatch } from "../../../shared/agent-identity";

export async function jobAgentIdentitiesResponse(request: Request, db: D1DatabaseLike): Promise<Response> {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const chain = url.searchParams.get("chainId");
  const ids = url.searchParams.get("jobIds")?.split(",") ?? [];
  if (keys.sort().join(",") !== "chainId,jobIds" || (chain !== "56" && chain !== "97")
    || !ids.length || ids.length > IDENTITY_BATCH_LIMIT || new Set(ids).size !== ids.length
    || ids.some(id => !/^(?:0|[1-9]\d{0,15})$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const chainId = Number(chain) as IdentityChainId;
  try {
    const repository = new D1AgentIdentityRepository(db);
    const { jobs, events } = await repository.readJobEvidence(chainId, ids);
    const [wallets, agents] = await Promise.all([
      repository.findByWallets(chainId, jobs.map(job => job.provider)),
      repository.findByIds(chainId, events.map(event => event.agentId)),
    ]);
    const refs = new Map(agents.map(agent => [agent.agentId, agent]));
    const body: JobIdentityBatch = { chainId, coverage: "partial", jobs: jobs.map(job => {
      const matches = wallets.get(job.provider.toLowerCase());
      return { jobId: String(job.jobId), provider: job.provider,
        registered: events.filter(event => event.jobId === String(job.jobId) && event.txHash !== null)
          .map(event => ({ agent: refs.get(event.agentId)!, verifiedAt: event.verifiedAt, txHash: event.txHash! })),
        candidates: matches?.candidates ?? [], candidatesTruncated: matches?.truncated ?? false };
    }) };
    return Response.json({ schemaVersion: 1, ...body }, { headers: { "cache-control": "public, max-age=30" } });
  } catch {
    return Response.json({ error: "identity_index_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
