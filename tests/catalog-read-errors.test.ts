import { afterEach, expect, it, vi } from "vitest";
import { getCatalogCandidatePageResult, getCatalogCandidatePage } from "../src/data/observation/catalog-candidate-feed";
const input = { page: 1, limit: 24, fresh: true, env: { OBSERVATIONS_URL: "https://worker.invalid/observations" } };
afterEach(() => vi.unstubAllGlobals());
it.each([
  [() => Promise.reject(new DOMException("sanitized", "TimeoutError")), "timeout"],
  [() => Promise.reject(new TypeError("sanitized")), "network"],
  [() => Promise.resolve(new Response(null, { status: 503 })), "upstream"],
  [() => Promise.resolve(Response.json({ broken: true })), "invalid_response"],
] as const)("classifies failed reads without changing the nullable adapter (%s)", async (fetcher, kind) => {
  const mock = vi.fn(fetcher); vi.stubGlobal("fetch", mock);
  expect(await getCatalogCandidatePageResult(input)).toMatchObject({ ok: false, error: { kind } });
  expect(mock).toHaveBeenCalledOnce();
  expect(await getCatalogCandidatePage(input)).toBeNull();
});
it("marks an unconfigured service unavailable without making a request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await getCatalogCandidatePageResult({ ...input, env: {} })).toEqual({ ok: false, error: { kind: "unavailable" } });
  expect(fetcher).not.toHaveBeenCalled();
});
