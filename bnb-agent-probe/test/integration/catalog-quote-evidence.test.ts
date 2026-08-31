import { env } from "cloudflare:workers";
import { NegotiationResponse, TermSpecification } from "@bnbagent/sdk/erc8183";
import { describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";

import type { D1Database } from "../../src/types";
import {
  BSC_COMMERCE,
  BSC_PAYMENT_TOKEN,
  BSC_POLICY,
  BSC_ROUTER,
} from "../../src/lib/chain";
import { buildGridProbeRequest, GRID_PROBE_REQUEST_HASH } from "../../src/lib/terms";
import { catalogQuoteEvidenceResponse } from "../../src/routes/catalog-quote-evidence";
import { clearCatalogFixtures } from "./catalog-fixtures";

const NOW = 1_788_000_000_000;
const NOW_SECONDS = NOW / 1_000;
const ENDPOINT_KEY = "e".repeat(64);
const PROVIDER = "0x1111111111111111111111111111111111111111" as Address;

function acceptedEnvelope(): Record<string, unknown> {
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
  return {
    request,
    request_hash: GRID_PROBE_REQUEST_HASH,
    response,
    response_hash: NegotiationResponse.fromDict(response).computeHash(),
    negotiation_hash: `0x${"c".repeat(64)}`,
    provider_sig: `0x${"d".repeat(130)}`,
    provider_address: PROVIDER,
    chain_id: 56,
    verifying_contract: BSC_COMMERCE,
  };
}

function request(envelope: Record<string, unknown>, agentId = "42", endpointKey = ENDPOINT_KEY) {
  return new Request("https://worker.test/catalog-quote-evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 2,
      agentId,
      endpointKey,
      probeCategory: "grid_trading",
      envelope,
    }),
  });
}

const context = {
  provider: PROVIDER,
  walletSource: "agentWallet" as const,
  blockNumber: 123n,
  blockTimestamp: BigInt(NOW_SECONDS - 10),
  commerce: BSC_COMMERCE,
  router: BSC_ROUTER,
  policy: BSC_POLICY,
  paymentToken: BSC_PAYMENT_TOKEN,
  tokenDecimals: 18,
  policyAllowlisted: true as const,
  publicClient: {} as PublicClient,
};

beforeEach(async () => {
  await clearCatalogFixtures();
  await env.DB.prepare(`INSERT INTO catalog_agents (
    agentKey, agentId, chainId, categoriesJson, metadataState, indexState, firstSeenAt, lastSeenAt
  ) VALUES ('eip155:56:42', '42', 56, '["grid_trading"]', 'ok', 'current', ?, ?)`).bind(NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_endpoints (
    endpointKey, protocol, endpoint, safety, nextProbeAt, declaredProtocol,
    role, validationProtocol, eligibility
  ) VALUES (?, 'a2a', 'https://seller.example.com/a2a', 'safe', 0, 'a2a',
    'operational', 'a2a', 'eligible')`).bind(ENDPOINT_KEY).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_endpoints (
    agentKey, endpointKey, declarationState, firstSeenAt, lastSeenAt
  ) VALUES ('eip155:56:42', ?, 'current', ?, ?)`).bind(ENDPOINT_KEY, NOW, NOW).run();
  await env.DB.prepare(`INSERT INTO catalog_agent_admission (
    agentKey, state, commerceTransport, endpointKey, chainId, provider, validatedAt, configurationVersion
  ) VALUES ('eip155:56:42', 'candidate', 'a2a', ?, 56, NULL, NULL, 'test-v2')`)
    .bind(ENDPOINT_KEY).run();
});

describe("catalog signed quote evidence", () => {
  it("independently verifies, sanitizes and deduplicates an exact signed artifact", async () => {
    const verifyQuote = vi.fn(async () => ({ valid: true as const, method: "eip191" as const, signer: PROVIDER }));
    const options = {
      nowMs: NOW,
      timeoutMs: 5_000,
      dependencies: { readChainContext: vi.fn(async () => context), verifyQuote, clock: () => 10 },
    };
    const first = await catalogQuoteEvidenceResponse(request(acceptedEnvelope()), env.DB as unknown as D1Database, options);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      schemaVersion: 2,
      status: "verified",
      artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      quote: { signatureMethod: "eip191", signer: PROVIDER, blockNumber: "123" },
      capabilities: { quoteStatus: "verified_fresh", canPrepareHire: true, buyerAction: "prepare_hire" },
    });
    expect(verifyQuote).toHaveBeenCalledOnce();

    const stored = await env.DB.prepare(`SELECT source, outcome, validationKind, verificationLevel,
      artifactHash, detailsJson FROM catalog_observations ORDER BY id`).all();
    expect(stored.results).toHaveLength(2);
    expect(stored.results[0]).toMatchObject({
      source: "browser_reported",
      outcome: "quote_verified",
      validationKind: "quote",
      verificationLevel: "cryptographic",
      artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(stored.results[1]).toMatchObject({
      source: "chain_read",
      validationKind: "chain",
      verificationLevel: "onchain",
    });
    expect(JSON.stringify(stored.results)).not.toContain("provider_sig");
    expect(JSON.stringify(stored.results)).not.toContain("envelope");
    expect(await env.DB.prepare(`SELECT state, commerceTransport, endpointKey, provider, validatedAt
      FROM catalog_agent_admission WHERE agentKey = 'eip155:56:42'`).first()).toMatchObject({
      state: "admitted",
      commerceTransport: "a2a",
      endpointKey: ENDPOINT_KEY,
      provider: PROVIDER,
      validatedAt: NOW,
    });
    expect(await env.DB.prepare(`SELECT marketplaceConfigured FROM catalog_agents
      WHERE agentKey = 'eip155:56:42'`).first()).toMatchObject({ marketplaceConfigured: 1 });

    const replay = await catalogQuoteEvidenceResponse(request(acceptedEnvelope()), env.DB as unknown as D1Database, options);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: "duplicate", observationId: expect.any(Number) });
    expect(verifyQuote).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_observations").first())
      .toMatchObject({ count: 2 });
  });

  it("rejects an undeclared target, changed terms and invalid account signature", async () => {
    const goodVerifier = vi.fn(async () => ({ valid: true as const, method: "erc1271" as const, signer: PROVIDER }));
    const options = {
      nowMs: NOW,
      timeoutMs: 5_000,
      dependencies: { readChainContext: vi.fn(async () => context), verifyQuote: goodVerifier },
    };
    expect((await catalogQuoteEvidenceResponse(
      request(acceptedEnvelope(), "42", "f".repeat(64)),
      env.DB as unknown as D1Database,
      options,
    )).status).toBe(409);

    const changed = acceptedEnvelope();
    ((changed.response as Record<string, unknown>).terms as Record<string, unknown>).deliverables = "different";
    changed.response_hash = NegotiationResponse.fromDict(changed.response as Record<string, unknown>).computeHash();
    const changedResponse = await catalogQuoteEvidenceResponse(request(changed), env.DB as unknown as D1Database, options);
    expect(changedResponse.status).toBe(422);
    expect(await changedResponse.json()).toMatchObject({ error: "quote_invalid", code: "QUOTE_TERMS" });

    const invalidSignature = await catalogQuoteEvidenceResponse(request(acceptedEnvelope()), env.DB as unknown as D1Database, {
      ...options,
      dependencies: {
        ...options.dependencies,
        verifyQuote: vi.fn(async () => ({ valid: false as const, reason: "ERC1271_INVALID" })),
      },
    });
    expect(invalidSignature.status).toBe(422);
    expect(await invalidSignature.json()).toMatchObject({ error: "quote_invalid", code: "QUOTE_SIGNATURE" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM catalog_observations").first())
      .toMatchObject({ count: 0 });
  });
});
