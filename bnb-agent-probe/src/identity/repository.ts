import type { D1DatabaseLike } from "../db/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../db/orm";
import { agentIdentities, catalogAgents, commerceJobs, hireEvents } from "../db/schema";
import { IDENTITY_REGISTRIES, type AgentReference, type IndexedAgentIdentity, type IdentityChainId } from "../../../shared/agent-identity";

/** Lightweight, batched identity reads. Never loads full profiles or calls RPC. */
export class D1AgentIdentityRepository {
  private readonly db: ReturnType<typeof createDatabase>;
  constructor(binding: D1DatabaseLike) { this.db = createDatabase(binding); }

  async readJobEvidence(chainId: IdentityChainId, ids: string[]) {
    const [jobs, events] = await Promise.all([
      this.db.select({ jobId: commerceJobs.jobId, provider: commerceJobs.provider }).from(commerceJobs)
        .where(and(eq(commerceJobs.chainId, chainId), inArray(commerceJobs.jobId, ids.map(Number)))),
      this.db.select({ jobId: hireEvents.jobId, agentId: hireEvents.agentId, txHash: hireEvents.txHash,
        verifiedAt: sql<number | null>`MAX(${hireEvents.verifiedAt})` }).from(hireEvents)
        .where(and(eq(hireEvents.chainId, chainId), eq(hireEvents.provenance, "chain_verified"), inArray(hireEvents.jobId, ids)))
        .groupBy(hireEvents.jobId, hireEvents.agentId).limit(251),
    ]);
    if (events.length > 250) throw new Error("IDENTITY_ATTRIBUTION_LIMIT");
    return { jobs, events };
  }

  async findByIds(chainId: IdentityChainId, ids: string[]): Promise<AgentReference[]> {
    if (!ids.length) return [];
    const unique = [...new Set(ids)];
    const names = new Map<string, string | null>();
    if (chainId === 56) for (let offset = 0; offset < unique.length; offset += 80) {
      const batch = unique.slice(offset, offset + 80);
      const rows = await this.db.select({ agentId: catalogAgents.agentId, name: catalogAgents.name }).from(catalogAgents)
        .where(and(eq(catalogAgents.chainId, chainId), eq(catalogAgents.indexState, "current"), inArray(catalogAgents.agentId, batch)));
      for (const row of rows) names.set(row.agentId, row.name);
    }
    return unique.map(agentId => ({ chainId, registryAddress: IDENTITY_REGISTRIES[chainId], agentId,
      name: names.get(agentId) ?? null, profileAvailable: chainId === 56 && names.has(agentId) }));
  }

  async findByWallets(chainId: IdentityChainId, wallets: string[]) {
    const result = new Map<string, { candidates: IndexedAgentIdentity[]; truncated: boolean }>();
    // A per-wallet bound prevents a shared operator wallet from returning an unbounded catalogue.
    // D1 batch executes all wallet lookups together; each uses the reverse index.
    const unique = [...new Set(wallets.map(wallet => wallet.toLowerCase()))];
    if (!unique.length) return result;
    const queries = unique.map(wallet => this.db.select().from(agentIdentities)
      .where(and(eq(agentIdentities.chainId, chainId), eq(agentIdentities.registryAddress, IDENTITY_REGISTRIES[chainId]), eq(agentIdentities.wallet, wallet)))
      .orderBy(asc(agentIdentities.agentId)).limit(11));
    const snapshots = await this.db.batch([queries[0]!, ...queries.slice(1)]);
    const refs = new Map((await this.findByIds(chainId, snapshots.flatMap(rows => rows.slice(0, 10).map(row => row.agentId))))
      .map(agent => [agent.agentId, agent]));
    unique.forEach((wallet, index) => result.set(wallet, {
      truncated: snapshots[index]!.length > 10,
      candidates: snapshots[index]!.slice(0, 10).map(row => ({ ...refs.get(row.agentId)!, wallet,
        source: row.source as "agentWallet" | "ownerOf", blockNumber: String(row.blockNumber), observedAt: row.observedAt })),
    }));
    return result;
  }
}
