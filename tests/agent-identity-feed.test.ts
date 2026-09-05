import { describe, expect, it } from "vitest";
import { parseJobIdentityBatch } from "../src/data/observation/agent-identity-feed.ts";
import { IDENTITY_REGISTRIES } from "../shared/agent-identity.ts";

const WALLET = `0x${"ab".repeat(20)}`;
const agent = { chainId: 56, registryAddress: IDENTITY_REGISTRIES[56], agentId: "7", name: "Grid Agent", profileAvailable: true };
const row = { jobId: "1", provider: WALLET, registered: [], candidatesTruncated: false,
  candidates: [{ ...agent, wallet: WALLET, source: "agentWallet", observedAt: 1_800_000_000_000, blockNumber: "42" }] };
const batch = { schemaVersion: 1, chainId: 56, coverage: "partial", jobs: [row] };
describe("identity feed validation", () => {
  it("parses a partial index without inventing coverage", () => {
    expect(parseJobIdentityBatch(batch, 56, ["1"]).jobs[0]?.candidates[0]?.name).toBe("Grid Agent");
  });
  it("rejects cross-chain replies, unrequested jobs and duplicate rows", () => {
    expect(() => parseJobIdentityBatch(batch, 97, ["1"])).toThrow();
    expect(() => parseJobIdentityBatch(batch, 56, ["2"])).toThrow();
    expect(() => parseJobIdentityBatch({ ...batch, jobs: [row, row] }, 56, ["1", "2"])).toThrow();
  });
  it("rejects malformed identity evidence and profile links on the wrong chain", () => {
    for (const patch of [{ source: "metadata" }, { observedAt: "yesterday" }, { registryAddress: WALLET }, { chainId: 97 }, { wallet: "x" }]) {
      expect(() => parseJobIdentityBatch({ ...batch, jobs: [{ ...row, candidates: [{ ...row.candidates[0], ...patch }] }] }, 56, ["1"])).toThrow();
    }
  });
});
