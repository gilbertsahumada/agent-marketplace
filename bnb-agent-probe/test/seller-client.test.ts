import { describe, expect, it, vi } from "vitest";

import { SellerProbeError, probeA2aSeller } from "../src/lib/seller-client";

const ENDPOINT = "https://seller.example.com/grid";
const MESSAGE_URL = "https://seller.example.com/api/sellers/grid/a2a";
const REQUEST = {
  task_description: "GRID_PLAN_V1:{}",
  terms: { deliverables: "plan", quality_standards: "safe" },
};

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

function reply(data: Record<string, unknown>): Response {
  return json({
    jsonrpc: "2.0",
    id: "response",
    result: { parts: [{ kind: "data", data }] },
  });
}

describe("Workers A2A seller probe", () => {
  it.each([
    [["negotiate-erc8183-job", "notify_funded"], "negotiate-erc8183-job"],
    [["negotiate", "notify_funded"], "negotiate"],
    [["negotiate", "negotiate-erc8183-job", "notify_funded"], "negotiate-erc8183-job"],
  ] as const)("accepts negotiation aliases and never calls notify_funded", async (skills, selected) => {
    const quote = { request_hash: "0x01" };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(card([...skills])))
      .mockResolvedValueOnce(reply(quote));

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
      "https://seller.example.com/another/same-origin/path",
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
});
