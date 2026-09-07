import { expect, it, vi } from "vitest";
import { BuyerQuoteLookupUnavailableError, resolveBuyerQuoteRequest } from "../src/data/observation/quote-request-sync";

const env = {
  OBSERVATIONS_URL: "https://worker.example/observations",
  BUYER_OBSERVATION_ALLOWED_ORIGIN: "https://worker.example",
  BUYER_OBSERVATION_SECRET: "test-only",
};

it("looks up an exact request with its network, not the latest history page", async () => {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ agentId: "2197", requests: [{ id: 730, kind: "buyer_quote", status: "expired" }] }));
  expect(await resolveBuyerQuoteRequest("2197", 730, { env, chainId: 97, fetchImpl })).toMatchObject({ id: 730 });
  const url = new URL(String(fetchImpl.mock.calls[0]![0]));
  expect(url.searchParams.get("requestId")).toBe("730");
  expect(url.searchParams.get("chainId")).toBe("97");
});

it.each([503, 401, 429])("does not turn HTTP %s into a missing quote", async status => {
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, fetchImpl: async () => Response.json({}, { status }) }))
    .rejects.toBeInstanceOf(BuyerQuoteLookupUnavailableError);
});

it("distinguishes a missing record from a network failure", async () => {
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, fetchImpl: async () => Response.json({ agentId: "2197", requests: [] }) })).resolves.toBeNull();
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, fetchImpl: async () => { throw new Error("timeout"); } })).rejects.toBeInstanceOf(BuyerQuoteLookupUnavailableError);
});

it.each([{}, { agentId: "42", requests: [] }, { agentId: "2197", requests: null }])("rejects malformed or wrong-agent responses", async body => {
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, fetchImpl: async () => Response.json(body) }))
    .rejects.toBeInstanceOf(BuyerQuoteLookupUnavailableError);
});

it("keeps recovery usable during the Worker rollout", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: "invalid_request" }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ agentId: "2197", requests: [{ id: 730, kind: "buyer_quote", status: "expired" }] }));
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, chainId: 97, fetchImpl })).resolves.toMatchObject({ id: 730 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("does not treat an absent legacy history row as proof that the quote is missing", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(Response.json({}, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ agentId: "2197", requests: [] }));
  await expect(resolveBuyerQuoteRequest("2197", 730, { env, fetchImpl })).rejects.toBeInstanceOf(BuyerQuoteLookupUnavailableError);
});
