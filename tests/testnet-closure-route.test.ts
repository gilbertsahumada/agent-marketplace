import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/marketplace/jobs/testnet/[jobId]/closure/route";
const read = vi.hoisted(() => vi.fn());
vi.mock("../src/business/testnet-closure", () => ({ readTestnetClosure: read }));
beforeEach(() => { read.mockReset(); });
it("returns fresh Testnet state with no-store", async () => {
  read.mockResolvedValue({ jobId: "514", chainId: 97, closure: "settlement_available" });
  const result = await GET(new Request("http://localhost"), { params: Promise.resolve({ jobId: "514" }) });
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect((await result.json()).chainId).toBe(97);
});
it("rejects invalid IDs without RPC and sanitizes unsupported/RPC failures", async () => {
  expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ jobId: "-1" }) })).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
  read.mockRejectedValue(new Error("internal RPC data"));
  const result = await GET(new Request("http://localhost"), { params: Promise.resolve({ jobId: "514" }) });
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("internal RPC data");
});
