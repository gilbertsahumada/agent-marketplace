import type { AgentIdentityRepository } from "../../business/entities/job-agent-resolution.ts";
import { IDENTITY_BATCH_LIMIT, IDENTITY_REGISTRIES, identityAddress, type AgentReference, type IdentityChainId, type JobIdentityBatch } from "../../../shared/agent-identity.ts";
import { AsyncTtlCache } from "../cache/async-ttl-cache.ts";
import { catalogUrl } from "./catalog-candidate-feed.ts";

const cache = new AsyncTtlCache(() => Date.now());
const invalid = (): never => { throw new Error("AGENT_IDENTITY_FEED_INVALID"); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid();
  return value as number;
}
function agent(value: unknown, chainId: IdentityChainId): AgentReference {
  const row = record(value);
  if (row.chainId !== chainId || row.registryAddress !== IDENTITY_REGISTRIES[chainId]
    || typeof row.agentId !== "string" || !/^[1-9]\d{0,19}$/.test(row.agentId)
    || !(row.name === null || (typeof row.name === "string" && row.name.length <= 4096))
    || typeof row.profileAvailable !== "boolean" || (chainId === 97 && row.profileAvailable)) invalid();
  return { chainId, registryAddress: row.registryAddress as string, agentId: row.agentId as string, name: row.name as string | null, profileAvailable: row.profileAvailable as boolean };
}
export function parseJobIdentityBatch(value: unknown, chainId: IdentityChainId, jobIds: string[]): JobIdentityBatch {
  const data = record(value);
  if (data.schemaVersion !== 1 || data.chainId !== chainId || data.coverage !== "partial" || !Array.isArray(data.jobs)
    || data.jobs.length > jobIds.length) invalid();
  const seen = new Set<string>();
  return { chainId, coverage: "partial", jobs: (data.jobs as unknown[]).map(value => {
    const row = record(value);
    if (typeof row.jobId !== "string" || !jobIds.includes(row.jobId) || seen.has(row.jobId)
      || !identityAddress(row.provider) || !Array.isArray(row.registered) || !Array.isArray(row.candidates)
      || row.candidates.length > 10 || typeof row.candidatesTruncated !== "boolean") invalid();
    const jobId = row.jobId as string;
    seen.add(jobId);
    return { jobId, provider: identityAddress(row.provider)!, candidatesTruncated: row.candidatesTruncated as boolean,
      registered: (row.registered as unknown[]).map(value => {
        const item = record(value);
        if (typeof item.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item.txHash)) invalid();
        return { agent: agent(item.agent, chainId), txHash: item.txHash as string, verifiedAt: item.verifiedAt === null ? null : timestamp(item.verifiedAt) };
      }),
      candidates: (row.candidates as unknown[]).map(value => {
        const item = record(value);
        if (!identityAddress(item.wallet) || (item.source !== "agentWallet" && item.source !== "ownerOf")
          || typeof item.blockNumber !== "string" || !/^\d{1,20}$/.test(item.blockNumber)) invalid();
        return { ...agent(item, chainId), wallet: identityAddress(item.wallet)!, source: item.source as "agentWallet" | "ownerOf",
          blockNumber: item.blockNumber as string, observedAt: timestamp(item.observedAt) };
      }),
    };
  }) };
}

export class WorkerAgentIdentityRepository implements AgentIdentityRepository {
  async readForJobs(input: { chainId: IdentityChainId; jobIds: string[] }): Promise<JobIdentityBatch> {
    if (!input.jobIds.length || input.jobIds.length > IDENTITY_BATCH_LIMIT
      || input.jobIds.some(id => !/^(?:0|[1-9]\d{0,15})$/.test(id))) invalid();
    const url = catalogUrl("/job-agent-identities", process.env);
    if (!url) throw new Error("AGENT_IDENTITY_FEED_UNAVAILABLE");
    const ids = [...new Set(input.jobIds)].sort();
    url.searchParams.set("chainId", String(input.chainId));
    url.searchParams.set("jobIds", ids.join(","));
    return cache.get(String(url), 30_000, async () => {
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("AGENT_IDENTITY_FEED_UNAVAILABLE");
      return parseJobIdentityBatch(await response.json(), input.chainId, ids);
    });
  }
}
