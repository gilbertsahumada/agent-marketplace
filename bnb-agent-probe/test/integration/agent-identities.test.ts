import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobAgentIdentitiesResponse } from "../../src/routes/job-agent-identities";
import { identitySnapshotStatement, runIdentityIndex } from "../../src/identity/indexer";
import type { D1DatabaseLike } from "../../src/db/client";
import { IDENTITY_REGISTRIES, type JobIdentityBatch } from "../../../shared/agent-identity";

const NOW = 1_800_000_000_000;
const WALLET = `0x${"ab".repeat(20)}`;
const OTHER = `0x${"cd".repeat(20)}`;
const ZERO = `0x${"00".repeat(20)}`;
const db = env.DB as unknown as D1DatabaseLike;
async function seedAgent(agentId: string, name = "Grid Agent") {
  await env.DB.prepare(`INSERT INTO catalog_agents
    (agentKey, agentId, chainId, name, metadataState, firstSeenAt, lastSeenAt) VALUES (?, ?, 56, ?, 'ok', ?, ?)`)
    .bind(`eip155:56:${agentId}`, agentId, name, NOW, NOW).run();
}
async function seedJob(chainId = 56) {
  await env.DB.prepare(`INSERT INTO commerce_jobs
    (chainId, jobId, client, provider, evaluator, budget, expiredAt, status, hook, firstSeenAt, updatedAt)
    VALUES (?, 1, ?, ?, ?, '1', ?, 0, ?, ?, ?)`).bind(chainId, OTHER, WALLET, OTHER, NOW, OTHER, NOW, NOW).run();
}
async function snapshot(agentId: string, wallet = WALLET, blockNumber = 42, chainId: 56 | 97 = 56) {
  await identitySnapshotStatement(db, { chainId, agentId, agentWallet: wallet, owner: OTHER, blockNumber, observedAt: NOW }).run();
}
const request = (query = "?chainId=56&jobIds=1") => jobAgentIdentitiesResponse(new Request(`https://worker.test/job-agent-identities${query}`), db);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM agent_identities").run();
  await env.DB.prepare("DELETE FROM catalog_agents").run();
  await env.DB.prepare("DELETE FROM commerce_jobs").run();
  await env.DB.prepare("DELETE FROM hire_events").run();
  await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'agent_identity_cursor:%'").run();
});
describe("reverse identity index", { timeout: 30_000 }, () => {
  it("resolves names for wallet matches outside the marketplace", async () => {
    await seedJob(); await seedAgent("7"); await snapshot("7");
    const response = await request();
    expect(response.status).toBe(200);
    const data = await response.json() as JobIdentityBatch;
    expect(data.jobs[0]?.registered).toEqual([]);
    expect(data.jobs[0]?.candidates[0]).toMatchObject({ name: "Grid Agent", agentId: "7", profileAvailable: true, blockNumber: "42" });
  });
  it("retains all candidates and marks truncation", async () => {
    await seedJob();
    for (let i = 1; i <= 12; i++) { await seedAgent(String(i)); await snapshot(String(i)); }
    const data = await (await request()).json() as JobIdentityBatch;
    expect(data.jobs[0]?.candidates).toHaveLength(10);
    expect(data.jobs[0]?.candidatesTruncated).toBe(true);
  });
  it("replaces rotated and zero wallets; rejects older snapshots", async () => {
    await seedJob(); await seedAgent("7"); await snapshot("7");
    await snapshot("7", OTHER, 43); await snapshot("7", WALLET, 41);
    expect((await (await request()).json() as JobIdentityBatch).jobs[0]?.candidates).toEqual([]);
    await snapshot("7", ZERO, 44);
    expect(await env.DB.prepare("SELECT wallet, source FROM agent_identities WHERE agentId = '7'").first()).toEqual({ wallet: null, source: null });
  });
  it("never joins a testnet ID to the mainnet name/profile", async () => {
    await seedJob(97); await seedAgent("7"); await snapshot("7", WALLET, 42, 97);
    const data = await (await request("?chainId=97&jobIds=1")).json() as JobIdentityBatch;
    expect(data.jobs[0]?.candidates[0]).toMatchObject({ name: null, profileAvailable: false, registryAddress: IDENTITY_REGISTRIES[97] });
  });
  it("returns registered attribution even before the wallet sweep finds it", async () => {
    await seedJob(); await seedAgent("7");
    await env.DB.prepare(`INSERT INTO hire_events
      (eventKey, agentId, chainId, phase, provenance, jobId, txHash, blockNumber, occurredAt, verifiedAt)
      VALUES ('test', '7', 56, 'funded', 'chain_verified', '1', ?, '42', ?, ?)`)
      .bind(`0x${"ab".repeat(32)}`, NOW, NOW).run();
    const data = await (await request()).json() as JobIdentityBatch;
    expect(data.jobs[0]?.registered[0]?.agent.name).toBe("Grid Agent");
    expect(data.jobs[0]?.candidates).toEqual([]);
  });
  it.each(["", "?chainId=1&jobIds=1", "?chainId=56&jobIds=1,1", "?chainId=56&jobIds=x", "?chainId=56&chainId=56&jobIds=1"])("rejects invalid query %s", async query => {
    expect((await request(query)).status).toBe(400);
  });
  it("scans in the background with block-pinned multicall and no owner fallback", async () => {
    await seedAgent("7");
    const multicall = vi.fn().mockResolvedValue([{ status: "success", result: ZERO }, { status: "success", result: OTHER }]);
    const reader = { getChainId: vi.fn().mockResolvedValue(56), getBlockNumber: vi.fn().mockResolvedValue(42n), multicall };
    const result = await runIdentityIndex(db, 56, reader as unknown as Parameters<typeof runIdentityIndex>[2], NOW);
    expect(result.stored).toBe(1);
    expect(multicall.mock.calls[0]?.[0].blockNumber).toBe(42n);
    expect(await env.DB.prepare("SELECT wallet FROM agent_identities WHERE agentId = '7'").first()).toEqual({ wallet: null });
  });
  it("does not overwrite a good snapshot on failed RPC reads", async () => {
    await seedAgent("7"); await snapshot("7");
    const reader = { getChainId: vi.fn().mockResolvedValue(56), getBlockNumber: vi.fn().mockResolvedValue(43n),
      multicall: vi.fn().mockResolvedValue([{ status: "failure", error: new Error("offline") }, { status: "failure", error: new Error("offline") }]) };
    await runIdentityIndex(db, 56, reader as unknown as Parameters<typeof runIdentityIndex>[2], NOW + 1000);
    expect(await env.DB.prepare("SELECT wallet, blockNumber FROM agent_identities WHERE agentId = '7'").first()).toEqual({ wallet: WALLET, blockNumber: 42 });
  });
});
