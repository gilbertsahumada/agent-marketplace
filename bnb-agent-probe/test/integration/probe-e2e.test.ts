import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import {
  NegotiationResponse,
  TermSpecification,
  buildDescriptionContent,
} from "@bnbagent/sdk/erc8183";
import {
  encodeFunctionResult,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadConfig } from "../../src/config";
import {
  BSC_COMMERCE,
  BSC_PAYMENT_TOKEN,
} from "../../src/lib/chain";
import { buildGridProbeRequest, GRID_PROBE_REQUEST_HASH } from "../../src/lib/terms";
import { createWp2ScheduledRunner } from "../../src/scheduled";
import type { Env } from "../../src/types";

const NOW_MS = 2_000_000_000_000;
const NOW_SECONDS = NOW_MS / 1_000;
const BLOCK_NUMBER = 50_000_000n;
const ENDPOINT = "https://bnb-agent-marketplace-ruby.vercel.app/grid";
const MESSAGE_URL = "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a";
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const ERC1271_PROVIDER = "0x2222222222222222222222222222222222222222" as Address;
const registryAbi = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const commerceAbi = parseAbi(["function paymentToken() view returns (address)"]);
const routerAbi = parseAbi(["function policyWhitelist(address policy) view returns (bool)"]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);
const erc1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM probe_observations").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
  await env.DB.prepare("DELETE FROM runtime_state").run();
});

describe("WP3 full Workers runtime", () => {
  it.each([
    ["eip191", account.address, 8],
    ["erc1271", ERC1271_PROVIDER, 10],
  ] as const)("reconciles, verifies a real %s quote and commits it atomically", async (
    signatureMethod,
    provider,
    expectedRequests,
  ) => {
    await env.DB.prepare(
      `INSERT INTO probe_targets (
         agentId, chainId, transport, endpoint, name, categoriesJson,
         categoryProvenance, declarationState, currentMetadataUpdatedAt,
         lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
       ) VALUES ('303779', 56, 'a2a', ?, 'Grid', '["grid_trading"]',
         'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1)`,
    ).bind(ENDPOINT, NOW_MS - 1_000, NOW_MS, NOW_MS, NOW_MS, NOW_MS).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', ?)",
    ).bind(NOW_MS - 1_000).run();

    const quote = await signedQuote(provider);
    const rpcRequests: Array<{ id: number; method: string; params?: unknown[] }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "trust8004.xyz") {
        return Response.json({
          chainId: 56,
          agentId: "303779",
          name: "Grid",
          registeredAt: NOW_MS - 10_000,
          metadataUpdatedAt: NOW_MS,
          metadataReasonCode: "ok",
          services: [],
          endpoints: [{ type: "A2A", url: ENDPOINT }],
        });
      }
      if (url.hostname === "bnb-agent-marketplace-ruby.vercel.app") {
        if (url.pathname.endsWith("/.well-known/agent-card.json")) {
          return Response.json({
            name: "Grid",
            url: MESSAGE_URL,
            skills: [{ id: "negotiate-erc8183-job" }, { id: "notify_funded" }],
          });
        }
        const requestId = JSON.parse(String(init?.body)).id as string;
        return Response.json({
          jsonrpc: "2.0",
          id: requestId,
          result: { parts: [{ kind: "data", data: quote }] },
        });
      }
      if (url.hostname === "rpc.example.com") {
        const request = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params?: unknown[];
        };
        rpcRequests.push(request);
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: rpcResult(request, provider),
        });
      }
      return new Response(null, { status: 404 });
    };
    const runner = createWp2ScheduledRunner({
      now: () => NOW_MS,
      randomUUID: () => "wp3-e2e",
      fetch: fetchImpl,
    });

    await expect(runner(
      { scheduledTime: NOW_MS, cron: "queue" },
      { ...env, BSC_RPC_URL: "https://rpc.example.com/bsc" } as unknown as Env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("completed");

    const observation = await env.DB.prepare(
      `SELECT outcome, errorCode, signatureMethod, signer, observedBlockNumber,
              requestHash, negotiationHash
       FROM probe_observations`,
    ).first<Record<string, unknown>>();
    expect(observation).toMatchObject({
      outcome: "quote_verified",
      signatureMethod,
      signer: provider,
      observedBlockNumber: String(BLOCK_NUMBER),
      requestHash: GRID_PROBE_REQUEST_HASH,
      negotiationHash: quote.negotiation_hash,
    });
    const summary = await runtimeJson("last_probe_summary");
    expect(summary).toMatchObject({ outcome: "quote_verified", requests: expectedRequests });
    const expectedRpcMethods = [
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_chainId",
      "eth_getBlockByNumber",
    ];
    if (signatureMethod === "erc1271") expectedRpcMethods.push("eth_getCode", "eth_call");
    expect(rpcRequests.map(({ method }) => method)).toEqual(expectedRpcMethods);
    const fixedBlockTag = `0x${BLOCK_NUMBER.toString(16)}`;
    expect(rpcRequests[1]?.params?.[0]).toBe("latest");
    expect(rpcRequests[2]?.params?.at(-1)).toBe(fixedBlockTag);
    expect(rpcRequests[4]?.params?.[0]).toBe(fixedBlockTag);
    if (signatureMethod === "erc1271") {
      expect(rpcRequests[5]?.params?.at(-1)).toBe(fixedBlockTag);
      expect(rpcRequests[6]?.params?.at(-1)).toBe(fixedBlockTag);
    }
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
    expect(await runtimeInteger("last_queue_scheduled_time")).toBe(NOW_MS);
    const ledger = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key LIKE 'daily_budget_%'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(ledger?.textValue ?? "{}").d1Queries).toBeLessThanOrEqual(40);
  });

  it("rejects a wrong same-origin Grid message URL before the seller POST", async () => {
    await env.DB.prepare(
      `INSERT INTO probe_targets (
         agentId, chainId, transport, endpoint, name, categoriesJson,
         categoryProvenance, declarationState, currentMetadataUpdatedAt,
         lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
       ) VALUES ('303779', 56, 'a2a', ?, 'Grid', '["grid_trading"]',
         'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1)`,
    ).bind(ENDPOINT, NOW_MS - 1_000, NOW_MS, NOW_MS, NOW_MS, NOW_MS).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', ?)",
    ).bind(NOW_MS - 1_000).run();
    let sellerPosts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "trust8004.xyz") {
        return Response.json({
          chainId: 56,
          agentId: "303779",
          name: "Grid",
          registeredAt: NOW_MS - 10_000,
          metadataUpdatedAt: NOW_MS,
          metadataReasonCode: "ok",
          services: [],
          endpoints: [{ type: "A2A", url: ENDPOINT }],
        });
      }
      if (url.hostname === "rpc.example.com") {
        const request = JSON.parse(String(init?.body)) as { id: number; method: string; params?: unknown[] };
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: rpcResult(request, account.address),
        });
      }
      if (url.pathname.endsWith("/.well-known/agent-card.json")) {
        return Response.json({
          name: "Grid",
          url: "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/other/a2a",
          skills: [{ id: "negotiate-erc8183-job" }, { id: "notify_funded" }],
        });
      }
      sellerPosts += 1;
      return new Response(null, { status: 500 });
    };
    const runner = createWp2ScheduledRunner({
      now: () => NOW_MS,
      randomUUID: () => "wp3-message-url",
      fetch: fetchImpl,
    });

    await expect(runner(
      { scheduledTime: NOW_MS, cron: "queue" },
      { ...env, BSC_RPC_URL: "https://rpc.example.com/bsc" } as unknown as Env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("completed");

    expect(await env.DB.prepare(
      "SELECT outcome, errorCode FROM probe_observations",
    ).first()).toEqual({ outcome: "reachable", errorCode: "A2A_CARD_URL" });
    expect(sellerPosts).toBe(0);
  });

  it("commits a timeout instead of retrying when the shared deadline expires after BSC", async () => {
    await env.DB.prepare(
      `INSERT INTO probe_targets (
         agentId, chainId, transport, endpoint, name, categoriesJson,
         categoryProvenance, declarationState, currentMetadataUpdatedAt,
         lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
       ) VALUES ('303779', 56, 'a2a', ?, 'Grid', '["grid_trading"]',
         'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1)`,
    ).bind(ENDPOINT, NOW_MS - 1_000, NOW_MS, NOW_MS, NOW_MS, NOW_MS).run();
    await env.DB.prepare(
      "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', ?)",
    ).bind(NOW_MS - 1_000).run();
    let clock = NOW_MS;
    let sellerRequests = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "trust8004.xyz") {
        return Response.json({
          chainId: 56,
          agentId: "303779",
          name: "Grid",
          registeredAt: NOW_MS - 10_000,
          metadataUpdatedAt: NOW_MS,
          metadataReasonCode: "ok",
          services: [],
          endpoints: [{ type: "A2A", url: ENDPOINT }],
        });
      }
      if (url.hostname === "rpc.example.com") {
        const request = JSON.parse(String(init?.body)) as {
          id: number;
          method: string;
          params?: unknown[];
        };
        const result = rpcResult(request, account.address);
        if (request.method === "eth_call") clock = NOW_MS + 5_001;
        return Response.json({ jsonrpc: "2.0", id: request.id, result });
      }
      sellerRequests += 1;
      return new Response(null, { status: 500 });
    };
    const runner = createWp2ScheduledRunner({
      now: () => clock,
      randomUUID: () => "wp3-timeout",
      fetch: fetchImpl,
    });

    await expect(runner(
      { scheduledTime: NOW_MS, cron: "queue" },
      { ...env, BSC_RPC_URL: "https://rpc.example.com/bsc" } as unknown as Env,
      createExecutionContext(),
      loadConfig({ KILL_SWITCH: "0" }),
    )).resolves.toBe("completed");

    expect(await env.DB.prepare(
      "SELECT outcome, errorCode FROM probe_observations",
    ).first()).toEqual({ outcome: "unreachable", errorCode: "SELLER_TIMEOUT" });
    expect(sellerRequests).toBe(0);
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
  });

  it.each([
    ["redirect", "reachable", "SELLER_REDIRECT"],
    ["oversized", "reachable", "SELLER_RESPONSE_TOO_LARGE"],
    ["stream-timeout", "unreachable", "SELLER_TIMEOUT"],
  ] as const)(
    "persists and rotates a real seller %s transport failure",
    async (failure, expectedOutcome, expectedErrorCode) => {
      await env.DB.prepare(
        `INSERT INTO probe_targets (
           agentId, chainId, transport, endpoint, name, categoriesJson,
           categoryProvenance, declarationState, currentMetadataUpdatedAt,
           lastMetadataCheckedAt, firstSeenAt, lastChangedAt, lastSeenAt, priority
         ) VALUES ('303779', 56, 'a2a', ?, 'Grid', '["grid_trading"]',
           'derived:marketplace-inventory', 'current', ?, ?, ?, ?, ?, 1)`,
      ).bind(ENDPOINT, NOW_MS - 1_000, NOW_MS, NOW_MS, NOW_MS, NOW_MS).run();
      await env.DB.prepare(
        "INSERT INTO runtime_state (key, textValue, updatedAt) VALUES ('next_scheduler_phase', 'probe', ?)",
      ).bind(NOW_MS - 1_000).run();

      let sellerRequests = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === "trust8004.xyz") {
          return Response.json({
            chainId: 56,
            agentId: "303779",
            name: "Grid",
            registeredAt: NOW_MS - 10_000,
            metadataUpdatedAt: NOW_MS,
            metadataReasonCode: "ok",
            services: [],
            endpoints: [{ type: "A2A", url: ENDPOINT }],
          });
        }
        if (url.hostname === "rpc.example.com") {
          const request = JSON.parse(String(init?.body)) as {
            id: number;
            method: string;
            params?: unknown[];
          };
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: rpcResult(request, account.address),
          });
        }
        sellerRequests += 1;
        if (failure === "redirect") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://redirect.example/card" },
          });
        }
        if (failure === "oversized") {
          return Response.json({ padding: "x".repeat(257) });
        }
        const signal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const abort = () => controller.error(
              new DOMException("The operation was aborted", "AbortError"),
            );
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          },
        });
        return new Response(body, {
          headers: { "content-type": "application/json" },
        });
      };
      const runner = createWp2ScheduledRunner({
        now: () => NOW_MS,
        randomUUID: () => `wp3-${failure}`,
        fetch: fetchImpl,
      });

      await expect(runner(
        { scheduledTime: NOW_MS, cron: "queue" },
        { ...env, BSC_RPC_URL: "https://rpc.example.com/bsc" } as unknown as Env,
        createExecutionContext(),
        loadConfig({
          KILL_SWITCH: "0",
          PROBE_TIMEOUT_MS: failure === "stream-timeout" ? "50" : "5000",
          MAX_SELLER_RESPONSE_BYTES: "128",
        }),
      )).resolves.toBe("completed");

      expect(await env.DB.prepare(
        "SELECT outcome, errorCode FROM probe_observations",
      ).first()).toEqual({ outcome: expectedOutcome, errorCode: expectedErrorCode });
      expect(await env.DB.prepare(
        "SELECT priority FROM probe_targets WHERE agentId = '303779'",
      ).first()).toEqual({ priority: 0 });
      expect(await runtimeText("next_scheduler_phase")).toBe("header");
      expect(await runtimeJson("last_probe_summary")).toMatchObject({
        outcome: expectedOutcome,
      });
      expect(sellerRequests).toBe(1);
    },
  );
});

async function signedQuote(provider: Address): Promise<Record<string, unknown>> {
  const request = buildGridProbeRequest().toDict();
  const response = new NegotiationResponse({
    accepted: true,
    terms: new TermSpecification({
      deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
      qualityStandards: "Deterministic output, no order execution and no custody",
      price: "10000000000000000",
      currency: BSC_PAYMENT_TOKEN,
    }),
    quoteExpiresAt: NOW_SECONDS + 900,
  }).toDict();
  response.negotiated_at = NOW_SECONDS;
  const unsigned = {
    request,
    request_hash: GRID_PROBE_REQUEST_HASH,
    response,
    response_hash: NegotiationResponse.fromDict(response).computeHash(),
    chain_id: 56,
    verifying_contract: BSC_COMMERCE,
  };
  const content = buildDescriptionContent(unsigned, 56, BSC_COMMERCE);
  const negotiationHash = keccak256(stringToHex(canonicalJson(content)));
  return {
    ...unsigned,
    negotiation_hash: negotiationHash,
    provider_sig: provider === account.address
      ? await account.signMessage({ message: negotiationHash })
      : `0x${"22".repeat(65)}`,
    provider_address: provider,
  };
}

function rpcResult(
  request: { method: string; params?: unknown[] },
  provider: Address,
): unknown {
  if (request.method === "eth_chainId") return "0x38";
  if (request.method === "eth_getBlockByNumber") {
    return {
      number: `0x${BLOCK_NUMBER.toString(16)}`,
      timestamp: `0x${BigInt(NOW_SECONDS - 30).toString(16)}`,
      transactions: [],
    };
  }
  if (request.method === "eth_getCode") return "0x6001600055";
  if (request.method === "eth_call") {
    const call = request.params?.[0] as { data?: string } | undefined;
    if (call?.data?.startsWith("0x1626ba7e")) {
      return encodeFunctionResult({
        abi: erc1271Abi,
        functionName: "isValidSignature",
        result: "0x1626ba7e",
      });
    }
    const returnData = [
      encodeFunctionResult({ abi: registryAbi, functionName: "getAgentWallet", result: provider }),
      encodeFunctionResult({ abi: registryAbi, functionName: "ownerOf", result: provider }),
      encodeFunctionResult({ abi: commerceAbi, functionName: "paymentToken", result: BSC_PAYMENT_TOKEN }),
      encodeFunctionResult({ abi: routerAbi, functionName: "policyWhitelist", result: true }),
      encodeFunctionResult({ abi: tokenAbi, functionName: "decimals", result: 18 }),
    ].map((returnData) => ({ success: true, returnData }));
    return encodeFunctionResult({
      abi: multicallAbi,
      functionName: "aggregate3",
      result: returnData,
    });
  }
  throw new Error(`Unexpected read-only RPC method: ${request.method}`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function runtimeText(key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT textValue FROM runtime_state WHERE key = ?")
    .bind(key).first<{ textValue: string | null }>();
  return row?.textValue ?? null;
}

async function runtimeInteger(key: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT integerValue FROM runtime_state WHERE key = ?")
    .bind(key).first<{ integerValue: number | null }>();
  return row?.integerValue ?? null;
}

async function runtimeJson(key: string): Promise<Record<string, unknown>> {
  return JSON.parse(await runtimeText(key) ?? "{}") as Record<string, unknown>;
}
