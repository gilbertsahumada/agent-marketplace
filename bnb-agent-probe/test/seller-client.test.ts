import { describe, expect, it, vi } from "vitest";

import {
  SellerProbeError,
  probeA2aSeller,
  probeErc8183HttpSeller,
} from "../src/lib/seller-client";

const ENDPOINT = "https://seller.example.com/grid";
const MESSAGE_URL = "https://seller.example.com/api/sellers/grid/a2a";
const REQUEST = {
  task_description: "GRID_PLAN_V1:{}",
  terms: { deliverables: "plan", quality_standards: "safe" },
};
const HTTP_STATUS_EXPECTATION = {
  provider: "0x1111111111111111111111111111111111111111",
  commerce: "0x2222222222222222222222222222222222222222",
  router: "0x3333333333333333333333333333333333333333",
  policy: "0x4444444444444444444444444444444444444444",
  currency: "0x5555555555555555555555555555555555555555",
  decimals: 18,
} as const;

function validHttpStatus() {
  return {
    status: "ok",
    agent_address: HTTP_STATUS_EXPECTATION.provider,
    commerce_address: HTTP_STATUS_EXPECTATION.commerce,
    router_address: HTTP_STATUS_EXPECTATION.router,
    policy_address: HTTP_STATUS_EXPECTATION.policy,
    currency: HTTP_STATUS_EXPECTATION.currency,
    decimals: HTTP_STATUS_EXPECTATION.decimals,
    service_price: "1",
  };
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function card(skills = ["negotiate-erc8183-job", "notify_funded"]): Record<string, unknown> {
  return {
    name: "Grid seller",
    url: MESSAGE_URL,
    skills: skills.map((id) => ({ id })),
  };
}

function reply(data: Record<string, unknown>, id = "response"): Response {
  return json({
    jsonrpc: "2.0",
    id,
    result: { parts: [{ kind: "data", data }] },
  });
}

describe("Workers A2A seller probe", () => {
  it("invokes a Worker fetch dependency without using its input object as the receiver", async () => {
    const input = {
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch(this: unknown, request: RequestInfo | URL, init?: RequestInit) {
        expect(this).toBeUndefined();
        const destination = request.toString();
        return Promise.resolve(destination.endsWith("/.well-known/agent-card.json")
          ? json(card())
          : reply({ request_hash: "0x01" }, JSON.parse(String(init?.body)).id as string));
      },
    };

    await expect(probeA2aSeller(input)).resolves.toMatchObject({
      quote: { request_hash: "0x01" },
    });
  });

  it.each([
    [["negotiate-erc8183-job", "notify_funded"], "negotiate-erc8183-job"],
    [["negotiate", "notify_funded"], "negotiate"],
    [["negotiate", "negotiate-erc8183-job", "notify_funded"], "negotiate-erc8183-job"],
  ] as const)("accepts negotiation aliases and never calls notify_funded", async (skills, selected) => {
    const quote = { request_hash: "0x01" };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(card([...skills])))
      .mockImplementationOnce(async (_input, init) => {
        const requestId = JSON.parse(String(init?.body)).id as string;
        return reply(quote, requestId);
      });

    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
    })).resolves.toEqual({ quote, negotiationSkill: selected });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toBe(
      `${ENDPOINT}/.well-known/agent-card.json`,
    );
    const firstInit = fetchImpl.mock.calls[0]?.[1];
    const secondInit = fetchImpl.mock.calls[1]?.[1];
    expect(firstInit?.redirect).toBe("manual");
    expect(secondInit?.redirect).toBe("manual");
    expect(firstInit?.headers).toEqual({ accept: "application/json" });
    expect(secondInit?.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(secondInit?.body))).toMatchObject({
      jsonrpc: "2.0",
      method: "message/send",
      params: { message: { parts: [{ data: { skill: selected, ...REQUEST } }] } },
    });
    expect(String(secondInit?.body)).not.toContain("notify_funded");
    expect(String(secondInit?.body).toLowerCase()).not.toContain("authorization");
  });

  it.each([
    [
      "https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json",
      "https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json",
      "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a",
    ],
    [
      "https://seller.example.com/.well-known/agent-card.json",
      "https://seller.example.com/.well-known/agent-card.json",
      "https://seller.example.com/api/sellers/a2a",
    ],
  ])("derives one card and message URL from Agent Card declaration %s", async (
    endpoint,
    expectedCardUrl,
    expectedMessageUrl,
  ) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ...card(), url: expectedMessageUrl }))
      .mockImplementationOnce(async (_input, init) => {
        const requestId = JSON.parse(String(init?.body)).id as string;
        return reply({ request_hash: "0x01" }, requestId);
      });

    await expect(probeA2aSeller({
      endpoint,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
    })).resolves.toMatchObject({ quote: { request_hash: "0x01" } });

    expect(fetchImpl.mock.calls[0]?.[0].toString()).toBe(expectedCardUrl);
    expect(fetchImpl.mock.calls[1]?.[0].toString()).toBe(expectedMessageUrl);
  });

  it("requires the exact Grid message URL when the target policy supplies it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({
      ...card(),
      url: "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/other/a2a",
    }));

    await expect(probeA2aSeller({
      endpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
      expectedA2aMessageUrl: "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a",
    })).rejects.toMatchObject({ code: "A2A_CARD_URL" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [["negotiate-erc8183-job"], "A2A_REQUIRED_SKILLS"],
    [["negotiate-erc8183-job", "notify_funded", "notify_funded"], "A2A_REQUIRED_SKILLS"],
    [["notify_funded"], "A2A_REQUIRED_SKILLS"],
  ] as const)("rejects malformed skill membership", async (skills, code) => {
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json(card([...skills]))),
    })).rejects.toMatchObject({ code });
  });

  it("rejects cross-origin or credential-bearing Agent Card message URLs", async () => {
    for (const url of [
      "https://attacker.example/a2a",
      "https://user:secret@seller.example.com/a2a",
      "https://seller.example.com/a2a?token=secret",
    ]) {
      await expect(probeA2aSeller({
        endpoint: ENDPOINT,
        request: REQUEST,
        timeoutMs: 5_000,
        maxResponseBytes: 32_768,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ ...card(), url })),
      })).rejects.toMatchObject({ code: "A2A_CARD_URL" });
    }
  });

  it("accepts a public same-origin Agent Card message path for general targets", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ...card(), url: "https://seller.example.com/another/a2a" }))
      .mockImplementationOnce(async (_input, init) => {
        const requestId = JSON.parse(String(init?.body)).id as string;
        return reply({ request_hash: "0x01" }, requestId);
      });

    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
    })).resolves.toMatchObject({ negotiationSkill: "negotiate-erc8183-job" });
  });

  it.each([301, 302, 307, 308])("rejects HTTP %i without following Location", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status,
      headers: { location: "https://attacker.example" },
    }));
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
    })).rejects.toMatchObject({ code: "SELLER_REDIRECT" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a decompressed response above the configured cap", async () => {
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 128,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ padding: "x".repeat(256) })),
    })).rejects.toEqual(expect.objectContaining({
      code: "SELLER_RESPONSE_TOO_LARGE",
    } satisfies Partial<SellerProbeError>));
  });

  it("classifies an aborted fetch as the shared seller timeout", async () => {
    const timeout = new DOMException("The operation timed out", "TimeoutError");
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(timeout),
    })).rejects.toMatchObject({ code: "SELLER_TIMEOUT" });
  });

  it("classifies an aborted response stream as the shared seller timeout", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.error(new DOMException("The operation was aborted", "AbortError"));
      },
    });
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
        headers: { "content-type": "application/json" },
      })),
    })).rejects.toMatchObject({ code: "SELLER_TIMEOUT" });
  });

  it.each([
    [{ jsonrpc: "1.0", id: "request", result: { parts: [] } }],
    [{ jsonrpc: "2.0", id: "wrong", result: { parts: [] } }],
  ])("rejects an uncorrelated JSON-RPC reply", async (invalidReply) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(card()))
      .mockResolvedValueOnce(json(invalidReply));
    await expect(probeA2aSeller({
      endpoint: ENDPOINT,
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
    })).rejects.toMatchObject({ code: "A2A_PROTOCOL_ERROR" });
  });
});

describe("Workers ERC-8183 HTTP seller probe", () => {
  it("checks health and status before requesting a fresh quote", async () => {
    const quote = { request_hash: "0x01" };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "ok", service: "ERC-8183 Agent" }))
      .mockResolvedValueOnce(json(validHttpStatus()))
      .mockResolvedValueOnce(json(quote));

    await expect(probeErc8183HttpSeller({
      endpoint: "https://seller.example.com/erc8183",
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
      expectedHttpStatus: HTTP_STATUS_EXPECTATION,
    })).resolves.toMatchObject({ quote });

    expect(fetchImpl.mock.calls.map(([url]) => url.toString())).toEqual([
      "https://seller.example.com/erc8183/health",
      "https://seller.example.com/erc8183/status",
      "https://seller.example.com/erc8183/negotiate",
    ]);
  });

  it.each([
    ["agent_address", "0x9999999999999999999999999999999999999999"],
    ["commerce_address", "0x9999999999999999999999999999999999999999"],
    ["router_address", "0x9999999999999999999999999999999999999999"],
    ["policy_address", "0x9999999999999999999999999999999999999999"],
    ["currency", "0x9999999999999999999999999999999999999999"],
    ["decimals", 6],
  ])("rejects status identity/config mismatch in %s before negotiation", async (field, value) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "ok", service: "ERC-8183 Agent" }))
      .mockResolvedValueOnce(json({ ...validHttpStatus(), [field]: value }))
      .mockResolvedValueOnce(json({ request_hash: "must-not-be-returned" }));

    await expect(probeErc8183HttpSeller({
      endpoint: "https://seller.example.com/erc8183",
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
      expectedHttpStatus: HTTP_STATUS_EXPECTATION,
    })).rejects.toMatchObject({ code: "ERC8183_STATUS_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a quote response that finishes at the shared deadline", async () => {
    let clock = 0;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "ok", service: "ERC-8183 Agent" }))
      .mockResolvedValueOnce(json(validHttpStatus()))
      .mockImplementationOnce(async () => {
        clock = 5_000;
        return json({ request_hash: "too-late" });
      });

    await expect(probeErc8183HttpSeller({
      endpoint: "https://seller.example.com/erc8183",
      request: REQUEST,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768,
      fetch: fetchImpl,
      now: () => clock,
      expectedHttpStatus: HTTP_STATUS_EXPECTATION,
    })).rejects.toMatchObject({ code: "SELLER_TIMEOUT" });
  });
});
