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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { loadConfig } from "../../src/config";
import {
  BSC_COMMERCE,
  BSC_PAYMENT_TOKEN,
  BSC_POLICY,
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

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM probe_observations").run();
  await env.DB.prepare("DELETE FROM probe_targets").run();
  await env.DB.prepare("DELETE FROM runtime_state").run();
});

describe("WP3 full Workers runtime", () => {
  it("reconciles, verifies a real EIP-191 quote and commits it atomically", async () => {
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

    const quote = await signedQuote();
    const rpcMethods: string[] = [];
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
        };
        rpcMethods.push(request.method);
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: rpcResult(request.method),
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
      signatureMethod: "eip191",
      signer: account.address,
      observedBlockNumber: String(BLOCK_NUMBER),
      requestHash: GRID_PROBE_REQUEST_HASH,
      negotiationHash: quote.negotiation_hash,
    });
    const summary = await runtimeJson("last_probe_summary");
    expect(summary).toMatchObject({ outcome: "quote_verified", requests: 8 });
    expect(rpcMethods).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_call",
      "eth_chainId",
      "eth_getBlockByNumber",
    ]);
    expect(await runtimeText("next_scheduler_phase")).toBe("header");
    expect(await runtimeInteger("last_queue_scheduled_time")).toBe(NOW_MS);
    const ledger = await env.DB.prepare(
      "SELECT textValue FROM runtime_state WHERE key LIKE 'daily_budget_%'",
    ).first<{ textValue: string }>();
    expect(JSON.parse(ledger?.textValue ?? "{}").d1Queries).toBeLessThanOrEqual(40);
  });
});

async function signedQuote(): Promise<Record<string, unknown>> {
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
    provider_sig: await account.signMessage({ message: negotiationHash }),
    provider_address: account.address,
  };
}

function rpcResult(method: string): unknown {
  if (method === "eth_chainId") return "0x38";
  if (method === "eth_getBlockByNumber") {
    return {
      number: `0x${BLOCK_NUMBER.toString(16)}`,
      timestamp: `0x${BigInt(NOW_SECONDS - 30).toString(16)}`,
      transactions: [],
    };
  }
  if (method === "eth_call") {
    const returnData = [
      encodeFunctionResult({ abi: registryAbi, functionName: "getAgentWallet", result: account.address }),
      encodeFunctionResult({ abi: registryAbi, functionName: "ownerOf", result: account.address }),
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
  throw new Error(`Unexpected read-only RPC method: ${method}`);
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
