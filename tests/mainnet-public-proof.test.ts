import { describe, expect, it } from "vitest";
import type { MainnetJobProof } from "../src/business/entities/mainnet-job-proof.ts";
import { InvalidPublicJobProofIdError, PublicJobProofNotFoundError } from "../src/business/errors/public-job-proof-errors.ts";
import { GetPublicMainnetJobProof } from "../src/business/use-cases/get-mainnet-job-proof.ts";
import { StaticMainnetJobProofRepository } from "../src/data/proofs/mainnet-job-proof-repository.ts";

const proof = {
  schemaVersion: 1,
  capturedAt: "2026-08-26T10:00:00.000Z",
  chainId: 56,
  agentId: "303779",
  jobId: "700",
  buyer: `0x${"11".repeat(20)}`,
  seller: `0x${"22".repeat(20)}`,
  token: `0x${"33".repeat(20)}`,
  budgetRaw: "1",
  finalState: "SUBMITTED",
  deliverableHash: `0x${"44".repeat(32)}`,
  resultHashVerified: true,
  deterministicResultVerified: true,
  durationSeconds: "42",
  totalGasCostWei: "1234",
  transactions: {},
} satisfies MainnetJobProof;

describe("GetPublicMainnetJobProof", () => {
  const useCase = new GetPublicMainnetJobProof({ getPrimary: () => proof });

  it("returns only the matching versioned Mainnet proof", () => {
    expect(useCase.execute({ jobId: "700" })).toEqual(proof);
  });

  it("rejects invalid or unrecorded IDs", () => {
    expect(() => useCase.execute({ jobId: "0" })).toThrow(InvalidPublicJobProofIdError);
    expect(() => useCase.execute({ jobId: "701" })).toThrow(PublicJobProofNotFoundError);
  });
});

describe("StaticMainnetJobProofRepository", () => {
  it("retains versioned historical proofs when the primary proof changes", () => {
    const previous = { ...proof, jobId: "699", capturedAt: "2026-08-25T10:00:00.000Z" };
    const repository = new StaticMainnetJobProofRepository(
      { schemaVersion: 1, proof },
      { schemaVersion: 1, proofs: [previous] },
    );

    expect(repository.listByAgentId("303779").map(({ jobId }) => jobId)).toEqual(["699", "700"]);
  });
});
