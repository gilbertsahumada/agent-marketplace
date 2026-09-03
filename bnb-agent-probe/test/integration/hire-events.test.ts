import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash } from "viem";

import { createWorker } from "../../src/index";
import { BSC_COMMERCE, BSC_TESTNET_COMMERCE } from "../../src/lib/chain";
import {
  commerceEventsAbi,
  hireEventsResponse,
  type HireChainId,
  type HireChainReader,
} from "../../src/routes/hire-events";
import type { Env } from "../../src/types";

const NOW = 1_788_000_000_000;
const BLOCK_TIMESTAMP = 1_787_999_000n;
const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52" as Address;
const SELLER = "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;
const TX_HASH = `0x${"ab".repeat(32)}` as Hash;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type FakeLog = { address: Address; data: `0x${string}`; topics: ReturnType<typeof encodeEventTopics> };

function fundedLog(commerce: Address, jobId: bigint): FakeLog {
  return {
    address: commerce,
    topics: encodeEventTopics({ abi: commerceEventsAbi, eventName: "JobFunded", args: { jobId, client: BUYER, provider: SELLER } }),
    data: encodeAbiParameters([{ type: "uint256" }], [1n]),
  };
}

function createdLog(commerce: Address, jobId: bigint): FakeLog {
  return {
    address: commerce,
    topics: encodeEventTopics({ abi: commerceEventsAbi, eventName: "JobCreated", args: { jobId, client: BUYER, provider: SELLER } }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }],
      [OTHER, 1_788_100_000n, OTHER],
    ),
  };
}

function fakeReader(overrides: {
  readonly to?: Address | null;
  readonly status?: "success" | "reverted";
  readonly logs?: readonly FakeLog[];
  readonly jobStatus?: number;
  readonly jobProvider?: Address;
  readonly agentWallet?: Address;
  readonly receiptError?: boolean;
} = {}): HireChainReader {
  const commerce = overrides.to === undefined ? BSC_COMMERCE : overrides.to;
  return {
    async getTransactionReceipt() {
      if (overrides.receiptError) throw new Error("TransactionReceiptNotFoundError");
      return {
        status: overrides.status ?? "success",
        to: commerce,
        blockNumber: 4_242n,
        logs: overrides.logs ?? [fundedLog(BSC_COMMERCE, 551n)],
      };
    },
    async getBlock() { return { timestamp: BLOCK_TIMESTAMP }; },
    async multicall() {
      return [
        {
          status: "success",
          result: {
            id: 551n,
            client: BUYER,
            provider: overrides.jobProvider ?? SELLER,
            evaluator: OTHER,
            description: "",
            budget: 1n,
            expiredAt: 0n,
            status: overrides.jobStatus ?? 1,
            hook: OTHER,
            submittedAt: 0n,
            deliverable: `0x${"0".repeat(64)}`,
          },
        },
        { status: "success", result: overrides.agentWallet ?? SELLER },
        { status: "success", result: SELLER },
      ];
    },
  } as unknown as HireChainReader;
}

const CALLER = "a".repeat(64);
const OTHER_CALLER = "b".repeat(64);

function request(body: Record<string, unknown>, caller: string | null = CALLER): Request {
  return new Request("https://worker.test/hire-events", {
    method: "POST",
    headers: { "content-type": "application/json", ...(caller === null ? {} : { "x-marketplace-caller": caller }) },
    body: JSON.stringify({ schemaVersion: 2, chainId: 56, agentId: "303779", jobId: null, txHash: null, ...body }),
  });
}

function fundedRequest(body: Record<string, unknown> = {}): Request {
  return request({ phase: "funded", jobId: "551", txHash: TX_HASH, ...body });
}

function respond(
  input: Request,
  reader: HireChainReader | null,
  chainId: HireChainId = 56,
  options: { callerKey?: string; callerDailyLimit?: number } = {},
) {
  return hireEventsResponse(input, env.DB, {
    rpcUrls: {},
    nowMs: NOW,
    timeoutMs: 5_000,
    callerKey: options.callerKey ?? CALLER,
    callerDailyLimit: options.callerDailyLimit ?? 20,
    ...(reader === null ? {} : { dependencies: { createReader: (requested) => {
      expect(requested).toBe(chainId);
      return reader;
    } } }),
  });
}

async function rows(): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare("SELECT * FROM hire_events ORDER BY id").all();
  return result.results ?? [];
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM hire_events").run();
});

describe("hire events", () => {
  it("records telemetry with a server-side key and timestamp and no job reference", async () => {
    const response = await respond(request({ phase: "clicked" }), null);
    expect(response.status).toBe(201);
    const body = await response.json() as { eventKey: string; provenance: string; occurredAt: number };
    expect(body).toMatchObject({ status: "recorded", provenance: "marketplace_observed", occurredAt: NOW });
    expect(body.eventKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await rows()).toMatchObject([{
      eventKey: body.eventKey, agentId: "303779", chainId: 56, phase: "clicked",
      provenance: "marketplace_observed", jobId: null, txHash: null, blockNumber: null, occurredAt: NOW, verifiedAt: null,
    }]);
  });

  it("verifies a funded phase against the receipt, event, job state and agent wallet, then deduplicates retries", async () => {
    const first = await respond(fundedRequest(), fakeReader());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      schemaVersion: 2,
      status: "recorded",
      eventKey: `56:${TX_HASH}:funded`,
      provenance: "chain_verified",
      occurredAt: Number(BLOCK_TIMESTAMP) * 1_000,
      blockNumber: "4242",
    });

    const retry = await respond(fundedRequest({ txHash: TX_HASH.toUpperCase().replace("0X", "0x") }), fakeReader());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ schemaVersion: 2, status: "duplicate", eventKey: `56:${TX_HASH}:funded` });

    expect(await rows()).toMatchObject([{
      eventKey: `56:${TX_HASH}:funded`, agentId: "303779", chainId: 56, phase: "funded", provenance: "chain_verified",
      jobId: "551", txHash: TX_HASH, blockNumber: "4242", occurredAt: Number(BLOCK_TIMESTAMP) * 1_000, verifiedAt: NOW,
    }]);
  });

  it("rejects a funded claim the chain does not support and stores nothing", async () => {
    const cases: Array<[HireChainReader, string]> = [
      [fakeReader({ logs: [createdLog(BSC_COMMERCE, 551n)] }), "EVENT_MISSING"],
      [fakeReader({ logs: [fundedLog(BSC_COMMERCE, 552n)] }), "EVENT_MISSING"],
      [fakeReader({ logs: [fundedLog(OTHER, 551n)] }), "EVENT_MISSING"],
      [fakeReader({ status: "reverted" }), "RECEIPT_REVERTED"],
      [fakeReader({ to: OTHER }), "CONTRACT_MISMATCH"],
      [fakeReader({ to: null }), "CONTRACT_MISMATCH"],
      [fakeReader({ jobStatus: 0 }), "JOB_STATUS_INCOMPATIBLE"],
      [fakeReader({ jobProvider: OTHER }), "AGENT_MISMATCH"],
      [fakeReader({ agentWallet: ZERO, jobProvider: OTHER }), "AGENT_MISMATCH"],
      [fakeReader({ receiptError: true }), "RECEIPT_NOT_FOUND"],
    ];
    for (const [reader, code] of cases) {
      const response = await respond(fundedRequest(), reader);
      expect(response.status, code).toBe(409);
      expect(await response.json()).toEqual({ error: "phase_rejected", code });
    }
    expect(await rows()).toEqual([]);
  });

  it("verifies Testnet phases against the Testnet deployment and needs its own RPC", async () => {
    const reader = fakeReader({ to: BSC_TESTNET_COMMERCE, logs: [createdLog(BSC_TESTNET_COMMERCE, 551n)], jobStatus: 3 });
    const verified = await respond(
      request({ chainId: 97, agentId: "1866", phase: "created", jobId: "551", txHash: TX_HASH }),
      reader,
      97,
    );
    expect(verified.status).toBe(201);
    expect(await rows()).toMatchObject([{ chainId: 97, agentId: "1866", phase: "created", provenance: "chain_verified" }]);

    const unavailable = await respond(
      request({ chainId: 97, agentId: "1866", phase: "funded", jobId: "551", txHash: `0x${"cd".repeat(32)}` }),
      null,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "chain_unavailable", code: "BSC_TESTNET_RPC_URL_REQUIRED" });
  });

  it("rejects malformed events before touching the chain", async () => {
    const invalid = [
      request({ phase: "clicked", txHash: TX_HASH }),
      request({ phase: "funded", jobId: "551", txHash: null }),
      request({ phase: "settled", jobId: "551", txHash: "0x1234" }),
      request({ phase: "paid", jobId: "551", txHash: TX_HASH }),
      request({ phase: "clicked", chainId: 1 }),
      request({ phase: "clicked", agentId: "0" }),
      request({ phase: "clicked", ip: "203.0.113.1" }),
    ];
    for (const input of invalid) {
      const response = await respond(input, fakeReader());
      expect(response.status).toBe(400);
    }
    expect(await rows()).toEqual([]);
  });

  it("is reachable only with the buyer observation bearer", async () => {
    const app = createWorker({ now: () => NOW });
    const withoutSecret = await app.fetch(request({ phase: "clicked" }), env as unknown as Env);
    expect(withoutSecret.status).toBe(404);

    const secured = { ...env, BUYER_OBSERVATION_SECRET: "buyer-secret" } as unknown as Env;
    const unauthorized = await app.fetch(request({ phase: "clicked" }), secured);
    expect(unauthorized.status).toBe(401);

    const authorized = (caller: string | null) => new Request("https://worker.test/hire-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer buyer-secret",
        ...(caller === null ? {} : { "x-marketplace-caller": caller }),
      },
      body: JSON.stringify({ schemaVersion: 2, chainId: 56, agentId: "303779", phase: "clicked", jobId: null, txHash: null }),
    });
    // A per-caller budget needs a caller: no fingerprint, no anonymous bucket.
    const unfingerprinted = await app.fetch(authorized(null), secured);
    expect(unfingerprinted.status).toBe(400);
    const malformed = await app.fetch(authorized("not-a-fingerprint"), secured);
    expect(malformed.status).toBe(400);
    const recorded = await app.fetch(authorized(CALLER), secured);
    expect(recorded.status).toBe(201);
    expect(await rows()).toMatchObject([{ phase: "clicked", callerKey: CALLER }]);
  });

  it("budgets telemetry per caller and UTC day, never chain phases", async () => {
    const limit = { callerDailyLimit: 1 };
    const first = await respond(request({ phase: "clicked" }), null, 56, limit);
    expect(first.status).toBe(201);
    const exhausted = await respond(request({ phase: "clicked" }), null, 56, limit);
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers.get("retry-after")).toBe(String(Math.ceil((Math.floor(NOW / 86_400_000) * 86_400_000 + 86_400_000 - NOW) / 1_000)));
    expect(exhausted.headers.get("cache-control")).toBe("no-store");
    expect(await exhausted.json()).toMatchObject({ error: "caller_daily_budget_exhausted" });
    const otherCaller = await respond(request({ phase: "clicked" }, OTHER_CALLER), null, 56, { ...limit, callerKey: OTHER_CALLER });
    expect(otherCaller.status).toBe(201);
    const chainPhase = await respond(fundedRequest(), fakeReader(), 56, limit);
    expect(chainPhase.status).toBe(201);
    expect(await rows()).toMatchObject([
      { phase: "clicked", provenance: "marketplace_observed", callerKey: CALLER },
      { phase: "clicked", provenance: "marketplace_observed", callerKey: OTHER_CALLER },
      { phase: "funded", provenance: "chain_verified", callerKey: CALLER },
    ]);
  });
});
