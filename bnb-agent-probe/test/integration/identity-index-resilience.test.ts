import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { runIdentityIndex } from "../../src/identity/indexer";
import type { D1DatabaseLike } from "../../src/db/client";
import { IDENTITY_REGISTRIES } from "../../../shared/agent-identity";

const NOW = 1_800_000_000_000;
const wallet = `0x${"ab".repeat(20)}`;
const db = env.DB as unknown as D1DatabaseLike;
const reader = () => ({ getChainId: vi.fn().mockResolvedValue(56), getBlockNumber: vi.fn().mockResolvedValue(42n),
  multicall: vi.fn(async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: "success", result: wallet }))) });
async function seed(id: string, chainId = 56) {
  await env.DB.prepare("INSERT INTO catalog_agents(agentKey,agentId,chainId,metadataState,indexState,firstSeenAt,lastSeenAt) VALUES (?,?,?,'ok','current',?,?)")
    .bind(`eip155:${chainId}:${id}`, id, chainId, NOW, NOW).run();
}
beforeEach(async () => {
  for (const table of ["agent_identities", "catalog_agents", "hire_events", "probe_targets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare("DELETE FROM runtime_state WHERE key LIKE 'agent_identity_%'").run();
});

it("advances the raw mixed page, crosses an all-invalid page, and wraps without crossing networks", async () => {
  for (let i = 10; i < 29; i++) await seed(String(i));
  await seed("29bad");
  for (let i = 30; i < 50; i++) await seed(`${i}bad`);
  await seed("50"); await seed("51", 97);
  const rpc = reader();
  const first = await runIdentityIndex(db, 56, rpc as never, NOW);
  expect(first).toMatchObject({ checked: 19, stored: 19 });
  expect(await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key LIKE 'agent_identity_cursor:56:%'").first()).toEqual({ textValue: "eip155:56:29bad" });
  rpc.multicall.mockClear();
  expect(await runIdentityIndex(db, 56, rpc as never, NOW + 1)).toMatchObject({ checked: 0 });
  expect(rpc.multicall).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key LIKE 'agent_identity_cursor:56:%'").first()).toEqual({ textValue: "eip155:56:49bad" });
  expect(await runIdentityIndex(db, 56, rpc as never, NOW + 2)).toMatchObject({ checked: 1 });
  expect(await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key LIKE 'agent_identity_cursor:56:%'").first()).toEqual({ textValue: "" });
  expect(await runIdentityIndex(db, 56, rpc as never, NOW + 3)).toMatchObject({ checked: 19 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM agent_identities WHERE chainId=97").first()).toEqual({ n: 0 });
});

it("backs off a never-stored priority identity across invocations and recovers after expiry", async () => {
  await seed("7");
  await env.DB.prepare("INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,txHash,blockNumber,occurredAt,verifiedAt) VALUES ('identity-retry','7',56,'funded','chain_verified','1',?,'42',?,?)")
    .bind(`0x${"ab".repeat(32)}`, NOW, NOW).run();
  const failed = reader();
  failed.multicall.mockImplementation(async ({ contracts }) => contracts.map(() => ({ status: "failure", result: "" })));
  expect(await runIdentityIndex(db, 56, failed as never, NOW)).toMatchObject({ checked: 1, stored: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM agent_identities").first()).toEqual({ n: 0 });
  const next = reader();
  expect(await runIdentityIndex(db, 56, next as never, NOW + 1)).toMatchObject({ checked: 0 });
  expect(next.multicall).not.toHaveBeenCalled();
  expect(await runIdentityIndex(db, 56, next as never, NOW + 3_600_000)).toMatchObject({ checked: 1, stored: 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'agent_identity_retry:%'").first()).toEqual({ n: 0 });
});

it("isolates invalid priority and refresh hints without broadening the accepted ID format", async () => {
  await seed("7");
  for (const id of ["0", "01", "-1", "100000000000000000000", "bad"]) {
    await env.DB.prepare("INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,txHash,blockNumber,occurredAt,verifiedAt) VALUES (?, ?,56,'funded','chain_verified','1',?,'42',?,?)")
      .bind(`invalid-${id}`, id, `0x${"ab".repeat(32)}`, NOW, NOW).run();
    await env.DB.prepare("INSERT INTO agent_identities(chainId,registryAddress,agentId,blockNumber,observedAt,nextCheckAt) VALUES (56,?,?,42,?,?)")
      .bind(IDENTITY_REGISTRIES[56], id, NOW - 1, NOW - 1).run();
  }
  const rpc = reader();
  expect(await runIdentityIndex(db, 56, rpc as never, NOW)).toMatchObject({ checked: 1, stored: 1, invalidIds: 5 });
  expect(rpc.multicall.mock.calls[0]?.[0].contracts).toHaveLength(2);
});

it("keeps backoff independent across networks for overlapping IDs", async () => {
  await seed("7");
  const failed = reader();
  failed.multicall.mockImplementation(async ({ contracts }) => contracts.map(() => ({ status: "failure", result: "" })));
  await runIdentityIndex(db, 56, failed as never, NOW);
  await env.DB.prepare("INSERT INTO hire_events(eventKey,agentId,chainId,phase,provenance,jobId,txHash,blockNumber,occurredAt,verifiedAt) VALUES ('testnet-seven','7',97,'funded','chain_verified','1',?,'42',?,?)")
    .bind(`0x${"ab".repeat(32)}`, NOW, NOW).run();
  const testnet = reader(); testnet.getChainId.mockResolvedValue(97);
  expect(await runIdentityIndex(db, 97, testnet as never, NOW + 1)).toMatchObject({ checked: 1, stored: 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM agent_identities WHERE chainId=56").first()).toEqual({ n: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'agent_identity_retry:56:%'").first()).toEqual({ n: 1 });
});

it.each(["getBlockNumber", "multicall"] as const)("backs off unseen identities when %s throws without creating attribution", async method => {
  await seed("7");
  const failed=reader();failed[method].mockRejectedValue(new Error("RPC_UNAVAILABLE"));
  await expect(runIdentityIndex(db,56,failed as never,NOW)).rejects.toThrow("RPC_UNAVAILABLE");
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM agent_identities").first()).toEqual({n:0});
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'agent_identity_cursor:%'").first()).toEqual({n:0});
  const next=reader();
  expect(await runIdentityIndex(db,56,next as never,NOW+1)).toMatchObject({checked:0});
  expect(next.multicall).not.toHaveBeenCalled();
  expect(await runIdentityIndex(db,56,next as never,NOW+3_600_000)).toMatchObject({stored:1});
});

it("rejects a mismatched registry network without marking identities as failed",async()=>{
  await seed("7");const wrong=reader();wrong.getChainId.mockResolvedValue(97);
  await expect(runIdentityIndex(db,56,wrong as never,NOW)).rejects.toThrow("IDENTITY_INDEX_WRONG_CHAIN");
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM runtime_state WHERE key LIKE 'agent_identity_retry:%'").first()).toEqual({n:0});
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM agent_identities").first()).toEqual({n:0});
});
