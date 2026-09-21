import { parseAbi, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import type { D1DatabaseLike } from "../db/client";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { createDatabase } from "../db/orm";
import { agentIdentities, catalogAgents, hireEvents, runtimeState } from "../db/schema";
import { createCountedBscClient } from "../lib/chain";
import { IDENTITY_REGISTRIES, providerIdentity, type IdentityChainId } from "../../../shared/agent-identity";

const ABI = parseAbi(["function getAgentWallet(uint256 agentId) view returns (address)", "function ownerOf(uint256 tokenId) view returns (address)"]);
const DISCOVERY_LIMIT = 20;
const REFRESH_LIMIT = 10;
const REFRESH_MS = 12 * 60 * 60 * 1_000;
type Reader = Pick<PublicClient, "getChainId" | "getBlockNumber" | "multicall">;

export function identityIndexReader(rpcUrl: string, chainId: IdentityChainId): Reader {
  return createCountedBscClient({ rpcUrl, chain: chainId === 56 ? bsc : bscTestnet,
    fetch: (...args) => fetch(...args), deadlineMs: Date.now() + 20_000, now: Date.now,
    methods: new Set(["eth_chainId", "eth_blockNumber", "eth_call"]), maxResponseBytes: 128 * 1024 });
}

/** Persist only successful, block-pinned reads; late queue messages cannot undo a rotation. */
export function identitySnapshotStatement(db: D1DatabaseLike, input: {
  chainId: IdentityChainId; agentId: string; blockNumber: number; observedAt: number;
  agentWallet: string; owner: string;
}) {
  if (!/^[1-9]\d{0,19}$/.test(input.agentId) || !/^0x[0-9a-fA-F]{40}$/.test(input.agentWallet)
    || !/^0x[0-9a-fA-F]{40}$/.test(input.owner) || !Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0
    || !Number.isSafeInteger(input.observedAt) || input.observedAt <= 0) throw new Error("IDENTITY_INDEX_INVALID_SNAPSHOT");
  const provider = providerIdentity({ ...input, allowOwnerFallback: false });
  const values = { chainId: input.chainId, registryAddress: IDENTITY_REGISTRIES[input.chainId], agentId: input.agentId,
    wallet: provider?.wallet ?? null, source: provider?.source ?? null, blockNumber: input.blockNumber,
    observedAt: input.observedAt, nextCheckAt: input.observedAt + REFRESH_MS };
  return createDatabase(db).insert(agentIdentities).values(values).onConflictDoUpdate({
    target: [agentIdentities.chainId, agentIdentities.registryAddress, agentIdentities.agentId], set: values,
    setWhere: sql`excluded.blockNumber > ${agentIdentities.blockNumber} OR
      (excluded.blockNumber = ${agentIdentities.blockNumber} AND excluded.observedAt >= ${agentIdentities.observedAt})`,
  });
}

/** Bounded discovery + independent refresh. Coverage is deliberately partial, never a registry census. */
export async function runIdentityIndex(db: D1DatabaseLike, chainId: IdentityChainId, reader: Reader, now = Date.now()) {
  const orm = createDatabase(db);
  const registry = IDENTITY_REGISTRIES[chainId];
  const key = `agent_identity_cursor:${chainId}:${registry}`;
  const retryPrefix = `agent_identity_retry:${chainId}:${registry}:`;
  const cursor = await orm.select({ textValue: runtimeState.textValue }).from(runtimeState).where(eq(runtimeState.key, key)).get();
  const discovery = chainId === 56
    ? await orm.select({ agentId: catalogAgents.agentId, cursor: catalogAgents.agentKey }).from(catalogAgents)
      .where(and(eq(catalogAgents.chainId, 56), gt(catalogAgents.agentKey, cursor?.textValue ?? ""), eq(catalogAgents.indexState, "current")))
      .orderBy(asc(catalogAgents.agentKey)).limit(DISCOVERY_LIMIT)
    : await orm.selectDistinct({ agentId: hireEvents.agentId, cursor: hireEvents.agentId }).from(hireEvents)
      .where(and(eq(hireEvents.chainId, 97), eq(hireEvents.provenance, "chain_verified"), gt(hireEvents.agentId, cursor?.textValue ?? "")))
      .orderBy(asc(hireEvents.agentId)).limit(DISCOVERY_LIMIT);
  const refresh = await orm.select({ agentId: agentIdentities.agentId }).from(agentIdentities)
    .where(and(eq(agentIdentities.chainId, chainId), eq(agentIdentities.registryAddress, registry), lte(agentIdentities.nextCheckAt, now)))
    .orderBy(asc(agentIdentities.nextCheckAt)).limit(REFRESH_LIMIT);
  // Existing hires/probe targets are discovery hints only. Always re-read the registry;
  // an old observation or a configured owner is never sufficient for a wallet match.
  const priority = await orm.all<{ agentId: string }>(sql`SELECT known.agentId FROM (
      SELECT agentId FROM hire_events WHERE chainId = ${chainId} AND provenance = 'chain_verified'
      UNION SELECT agentId FROM probe_targets WHERE chainId = ${chainId} AND declarationState = 'current'
    ) known LEFT JOIN agent_identities i ON i.chainId = ${chainId} AND i.registryAddress = ${registry} AND i.agentId = known.agentId
    WHERE (i.agentId IS NULL OR i.nextCheckAt <= ${now})
      AND NOT EXISTS (SELECT 1 FROM runtime_state r WHERE r.key = ${retryPrefix} || known.agentId AND r.integerValue > ${now})
    ORDER BY known.agentId LIMIT 10`);
  const candidates = [...new Set([...priority.map(row => row.agentId),
    ...discovery.map(row => row.agentId), ...refresh.map(row => row.agentId)])];
  // A malformed source row must not poison an entire page. Keep the raw page
  // for cursor advancement, including when every item on it is invalid.
  const valid = candidates.filter(id => /^[1-9]\d{0,19}$/.test(id));
  const retries = valid.length ? await orm.select({ key: runtimeState.key }).from(runtimeState)
    .where(and(inArray(runtimeState.key, valid.map(id => retryPrefix + id)), gt(runtimeState.integerValue, now))) : [];
  const deferred = new Set(retries.map(row => row.key));
  const ids = valid.filter(id => !deferred.has(retryPrefix + id));
  let stored = 0;
  if (ids.length) {
    const retryStatements = (agentId: string) => {
      // Retry state is never attribution evidence, including for new IDs.
      const retry = { key: retryPrefix + agentId, integerValue: now + 60 * 60 * 1000, updatedAt: now };
      return [orm.update(agentIdentities).set({ nextCheckAt: retry.integerValue })
        .where(and(eq(agentIdentities.chainId, chainId), eq(agentIdentities.registryAddress, registry),
          eq(agentIdentities.agentId, agentId), lte(agentIdentities.observedAt, now))),
        orm.insert(runtimeState).values(retry).onConflictDoUpdate({ target: runtimeState.key, set: retry,
          setWhere: lte(runtimeState.updatedAt, now) })];
    };
    const registryRead = async <T>(read: () => Promise<T>): Promise<T> => {
      try { return await read(); }
      catch (error) {
        const retry = ids.flatMap(retryStatements);
        await orm.batch([retry[0]!, ...retry.slice(1)]);
        // Preserve the failure and cursor; the next pass skips backed-off IDs.
        throw error;
      }
    };
    if (await registryRead(() => reader.getChainId()) !== chainId) throw new Error("IDENTITY_INDEX_WRONG_CHAIN");
    const block = await registryRead(() => reader.getBlockNumber());
    if (!Number.isSafeInteger(Number(block))) throw new Error("IDENTITY_INDEX_INVALID_BLOCK");
    const reads = await registryRead(() => reader.multicall({ blockNumber: block, allowFailure: true, contracts: ids.flatMap(agentId => [
      { address: registry, abi: ABI, functionName: "getAgentWallet" as const, args: [BigInt(agentId)] },
      { address: registry, abi: ABI, functionName: "ownerOf" as const, args: [BigInt(agentId)] },
    ]) }));
    const statements = ids.map((agentId, index) => {
      const wallet = reads[index * 2];
      const owner = reads[index * 2 + 1];
      if (wallet?.status !== "success" || owner?.status !== "success"
        || typeof wallet.result !== "string" || typeof owner.result !== "string") {
        return retryStatements(agentId);
      }
      stored++;
      return [identitySnapshotStatement(db, { chainId, agentId, blockNumber: Number(block), observedAt: now,
        agentWallet: wallet.result, owner: owner.result }),
        orm.delete(runtimeState).where(and(eq(runtimeState.key, retryPrefix + agentId), lte(runtimeState.updatedAt, now)))];
    }).flat();
    if (statements.length) await orm.batch([statements[0]!, ...statements.slice(1)]);
  }
  const rows = discovery;
  const next = rows.length < DISCOVERY_LIMIT ? "" : rows[rows.length - 1]!.cursor;
  await orm.insert(runtimeState).values({ key, textValue: next, updatedAt: now }).onConflictDoUpdate({
    target: runtimeState.key, set: { textValue: next, updatedAt: now },
    setWhere: lte(runtimeState.updatedAt, now),
  });
  return { chainId, checked: ids.length, stored, invalidIds: candidates.length - valid.length,
    deferred: deferred.size, coverage: "partial" as const };
}
