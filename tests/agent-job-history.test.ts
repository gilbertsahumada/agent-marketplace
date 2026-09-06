import { expect, it } from "vitest";
import { agentJobHistory } from "../components/marketplace/agent-job-history";
import type { HireJob } from "../src/business/entities/hire-job";
import type { MainnetJobProof } from "../src/business/entities/mainnet-job-proof";

it("uses current indexed state, deduplicates by network and never attributes wallet work to the agent", () => {
  const indexed = { chainId: 56, jobId: "1", status: "SUBMITTED" } as HireJob;
  const proof = { jobId: "1", finalState: "COMPLETED" } as MainnetJobProof;
  const model = agentJobHistory({ chainId: 56, scope: "wallet", jobs: [indexed, indexed], proofs: [proof, proof] });
  expect(model.indexed).toHaveLength(1);
  expect(model.proofs).toHaveLength(0);
  expect(model.agentCompleted).toBe(0);
  expect(model.agentTotal).toBe(1);
  expect(model.totals).toBeNull();
});

it("does not import Mainnet proof IDs into Testnet; totals are not page length", () => {
  const model = agentJobHistory({ chainId: 97, scope: "wallet", jobs: [], proofs: [{ jobId: "1" } as MainnetJobProof], totals: { total: 20, completed: 8, funded: 2, submitted: 1 } });
  expect(model.proofs).toEqual([]);
  expect(model.agentTotal).toBe(0);
  expect(model.totals?.total).toBe(20);
});
it("does not inject proof-only rows into an indexed page where they may recur on older pages", () => {
  const model = agentJobHistory({ chainId: 56, scope: "wallet", jobs: [], proofs: [{ jobId: "1" } as MainnetJobProof] });
  expect(model.proofs).toEqual([]);
});
