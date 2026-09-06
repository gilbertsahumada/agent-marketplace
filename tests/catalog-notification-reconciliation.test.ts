import { expect, it, vi } from "vitest";
import { CatalogErc8183Repository } from "../src/mainnet/catalog-erc8183-repository";
vi.mock("../src/verification/safe-http.ts", () => ({ createSafeEndpointTransport: async () => ({ fetch: vi.fn(), close: vi.fn() }) }));
vi.mock("../src/a2a.ts", () => ({
  fetchAgentCard: async () => ({ url: "https://seller.example", skills: [{ id: "notify_funded" }] }),
  notifyFunded: async () => { throw new Error("timeout after submission"); },
}));

function repository(status: string) {
  const repo = Object.create(CatalogErc8183Repository.prototype) as CatalogErc8183Repository;
  Object.assign(repo, { target: { transport: "a2a", endpoint: "https://seller.example" } });
  vi.spyOn(repo, "getJob").mockResolvedValueOnce({ status: "FUNDED" } as never).mockResolvedValue({ status, jobId: "56719" } as never);
  return repo;
}
it("recovers a submitted chain state after notification timeout", async () => {
  const repo = repository("SUBMITTED");
  await expect(repo.notifyFunded(56719n)).resolves.toMatchObject({ alreadySubmitted: true, job: { status: "SUBMITTED" } });
  expect(repo.getJob).toHaveBeenCalledTimes(2);
});
it("does not claim submission when the funded job has not advanced", async () => {
  await expect(repository("FUNDED").notifyFunded(56719n)).rejects.toThrow("notification could not be completed");
});
