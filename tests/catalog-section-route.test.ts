import { beforeEach, expect, it, vi } from "vitest";
const { read, cookie } = vi.hoisted(() => ({ read: vi.fn(), cookie: vi.fn() }));
vi.mock("../src/presentation/catalog-resources", () => ({ readCatalogResource: read }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookie }) }));
import { GET } from "../app/api/marketplace/catalog-section/route";
beforeEach(() => { vi.clearAllMocks(); cookie.mockReturnValue(undefined); read.mockResolvedValue({ ok: false, error: { kind: "timeout" } }); });
it.each(["resource=other", "resource=results&resource=facets", "resource=results&url=https://evil.invalid", "resource=results&network=bad", "resource=results&page=-1", "resource=results&network=mainnet&network=testnet"])("rejects invalid retry parameters: %s", async query => {
  expect((await GET(new Request(`https://app.invalid/api/marketplace/catalog-section?${query}`))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it("normalizes and reads only the requested section, using the server refresh cookie", async () => {
  cookie.mockReturnValue({ value: "1" });
  const response = await GET(new Request("https://app.invalid/api/marketplace/catalog-section?resource=facets&network=testnet&page=3&protocol=mcp&protocol=mcp"));
  expect(read).toHaveBeenCalledExactlyOnceWith("facets", expect.objectContaining({ page: 3, network: "testnet", protocols: ["mcp"] }), true);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: false, error: { kind: "timeout" } });
});
