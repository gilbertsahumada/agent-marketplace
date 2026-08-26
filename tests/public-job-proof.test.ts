import { describe, expect, it, vi } from "vitest";
import { GetPublicJobProof } from "../src/business/use-cases/get-public-job-proof.ts";
import {
  InvalidPublicJobProofIdError,
  PublicJobProofNotFoundError,
} from "../src/business/errors/public-job-proof-errors.ts";
import { GATE1_JOB_514_MANIFEST } from "../src/data/proofs/gate1-job-514.ts";
import { GATE6A_JOB_551_MANIFEST } from "../src/data/proofs/gate6a-job-551.ts";
import { Gate1PublicProofRepository } from "../src/data/proofs/gate1-public-proof-repository.ts";
import type { Gate1Proof, TransactionEvidence } from "../src/readiness/types.ts";
import type { Erc8183JobFacts } from "../src/business/entities/erc8183-browser-spike.ts";

function verifiedLiveProof(): Gate1Proof {
  const transactions = Object.fromEntries(
    Object.entries(GATE1_JOB_514_MANIFEST.transactions).map(([phase, evidence]) => [phase, {
      hash: evidence.hash,
      status: evidence.status,
      blockNumber: evidence.blockNumber,
      timestamp: evidence.timestamp,
    } satisfies TransactionEvidence]),
  );
  return {
    status: "verified",
    network: "bsc-testnet",
    chainId: 97,
    agentId: "1815",
    jobId: "514",
    expectedState: "SUBMITTED",
    observedState: "SUBMITTED",
    buyer: GATE1_JOB_514_MANIFEST.buyer,
    provider: GATE1_JOB_514_MANIFEST.seller,
    agentWallet: GATE1_JOB_514_MANIFEST.seller,
    paymentToken: GATE1_JOB_514_MANIFEST.payment.token,
    budget: GATE1_JOB_514_MANIFEST.payment.budgetRaw,
    deadline: GATE1_JOB_514_MANIFEST.lifecycle.deadline,
    submittedAt: GATE1_JOB_514_MANIFEST.lifecycle.submittedAt,
    deliverableHash: GATE1_JOB_514_MANIFEST.deliverable.hash,
    deliverableUrl: null,
    transactions,
    checks: {
      stateMatches: true,
      buyerMatches: true,
      providerMatches: true,
      agentWalletMatches: true,
      paymentTokenMatches: true,
      budgetMatches: true,
      deadlineMatches: true,
      submittedAtMatches: true,
      deliverableHashMatches: true,
      transactionsSucceeded: true,
      transactionEvidenceMatches: true,
    },
    observedAt: "2026-08-17T00:00:00.000Z",
    provenance: "onchain:bsc-testnet-rpc",
    error: null,
  };
}

describe("Gate 1 public proof manifest", () => {
  it("contains the versioned public evidence for Job 514", () => {
    expect(GATE1_JOB_514_MANIFEST).toMatchObject({
      schemaVersion: 1,
      source: "snapshot:gate1-job-514",
      chainId: 97,
      jobId: "514",
      sellerAgentId: "1815",
      lifecycle: {
        expectedState: "SUBMITTED",
        deadline: { unix: "1786640937", iso: "2026-08-13T17:08:57.000Z" },
        submittedAt: { unix: "1786636559", iso: "2026-08-13T15:55:59.000Z" },
      },
      fixture: {
        testInfrastructure: true,
        marketplaceAgent: false,
        officialReferenceAgent: false,
      },
    });
    expect(Object.keys(GATE1_JOB_514_MANIFEST.transactions)).toEqual([
      "createJob",
      "registerJob",
      "setBudget",
      "approve",
      "fund",
      "submit",
    ]);
  });

  it("does not publish secrets, keystores, environment data, or local paths", () => {
    const serialized = JSON.stringify(GATE1_JOB_514_MANIFEST);
    for (const forbidden of [
      /private[_-]?key/i,
      /mnemonic/i,
      /password/i,
      /keystore/i,
      /authorization/i,
      /bearer/i,
      /client[_-]?secret/i,
      /\/Users\//i,
      /\.gate1/i,
      /\.env/i,
    ]) {
      expect(serialized).not.toMatch(forbidden);
    }
  });
});

describe("Gate 6A public proof manifest", () => {
  it("publishes the browser-wallet Job 551 evidence without custody ambiguity", () => {
    expect(GATE6A_JOB_551_MANIFEST).toMatchObject({
      source: "snapshot:gate6a-job-551",
      chainId: 97,
      jobId: "551",
      sellerAgentId: "1866",
      quote: { signatureVerified: true },
      lifecycle: { expectedState: "SUBMITTED" },
      custody: { buyerWallet: "injected-eip1193", buyerPrivateKeyReceivedByServer: false },
      fixture: { testInfrastructure: true, marketplaceAgent: false },
    });
    expect(Object.keys(GATE6A_JOB_551_MANIFEST.transactions)).toEqual([
      "createJob", "registerJob", "setBudget", "approve", "fund", "submit",
    ]);
  });

  it("does not contain secrets or local paths", () => {
    expect(JSON.stringify(GATE6A_JOB_551_MANIFEST)).not.toMatch(
      /privateKey":"0x|SELLER_PRIVATE_KEY=|mnemonic|password|keystore|authorization|bearer|client[_-]?secret|\/Users\/|\.env/i,
    );
  });

});

describe("GetPublicJobProof", () => {
  it("verifies the versioned Job 551 snapshot against current chain facts", async () => {
    const snapshot = GATE6A_JOB_551_MANIFEST;
    const liveJob: Erc8183JobFacts = {
      chainId: 97,
      jobId: "551",
      buyer: snapshot.buyer,
      provider: snapshot.seller,
      evaluator: snapshot.contracts.router,
      policy: snapshot.contracts.policy,
      description: "signed quote",
      budgetRaw: snapshot.payment.budgetRaw,
      deadline: snapshot.lifecycle.deadline.unix,
      status: "COMPLETED",
      submittedAt: snapshot.lifecycle.submittedAt.unix,
      deliverableHash: snapshot.deliverable.hash,
      deliverableUrl: snapshot.deliverable.url,
      result: { content: snapshot.deliverable.content, contentType: snapshot.deliverable.contentType, hashVerified: true },
      quotedToken: snapshot.payment.token,
      quotedPriceRaw: snapshot.payment.budgetRaw,
      quoteExpiresAt: 1,
    };
    const proof = await new GetPublicJobProof(new Gate1PublicProofRepository({
      loadGate6aJob: async () => liveJob,
    })).execute({ jobId: "551" });
    expect(proof).toMatchObject({
      snapshot: { source: "snapshot:gate6a-job-551", custody: { buyerPrivateKeyReceivedByServer: false } },
      live: { status: "verified", observedState: "COMPLETED", checks: { resultHashVerified: true } },
    });
  });

  it("returns snapshot and current RPC evidence without collapsing provenance", async () => {
    const repository = new Gate1PublicProofRepository({
      loadLiveProof: async () => verifiedLiveProof(),
    });
    const proof = await new GetPublicJobProof(repository).execute({ jobId: "514" });
    expect(proof).toMatchObject({
      schemaVersion: 1,
      snapshot: { source: "snapshot:gate1-job-514", jobId: "514" },
      live: {
        status: "verified",
        source: "onchain:bsc-testnet-rpc",
        observedState: "SUBMITTED",
        deadline: { unix: "1786640937" },
        submittedAt: { unix: "1786636559" },
      },
    });
    expect(proof.live.transactions.submit?.timestamp).toBe("2026-08-13T15:55:59.000Z");
  });

  it("keeps the versioned snapshot available when live RPC initialization fails", async () => {
    const repository = new Gate1PublicProofRepository({
      loadLiveProof: async () => {
        throw new Error(
          "password=hunter2 private_key=0xdead authorization:Bearer123 https://private.example/rpc /Users/alice/.gate1/receipts/514.json",
        );
      },
      now: () => 1_776_643_200_000,
    });
    const proof = await new GetPublicJobProof(repository).execute({ jobId: "514" });
    expect(proof.snapshot.jobId).toBe("514");
    expect(proof.live).toMatchObject({
      status: "unavailable",
      observedAt: "2026-04-20T00:00:00.000Z",
      observedState: null,
      transactions: {},
      error: { code: "GATE1_PROOF_READ_FAILED" },
    });
    const serialized = JSON.stringify(proof);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("0xdead");
    expect(serialized).not.toContain("Bearer123");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("/Users/alice");
  });

  it("sanitizes an unavailable proof returned by the live reader", async () => {
    const unavailable: Gate1Proof = {
      ...verifiedLiveProof(),
      status: "read_error",
      observedState: null,
      buyer: null,
      provider: null,
      agentWallet: null,
      paymentToken: null,
      budget: null,
      deadline: null,
      submittedAt: null,
      deliverableHash: null,
      transactions: {},
      checks: {},
      error: {
        code: "GATE1_PROOF_READ_FAILED",
        message: "api_key=do-not-publish /Users/alice/wallets/seller.json",
      },
    };
    const repository = new Gate1PublicProofRepository({ loadLiveProof: async () => unavailable });
    const proof = await new GetPublicJobProof(repository).execute({ jobId: "514" });
    expect(proof.live.status).toBe("unavailable");
    expect(JSON.stringify(proof.live)).not.toContain("do-not-publish");
    expect(JSON.stringify(proof.live)).not.toContain("/Users/alice");
  });

  it("never publishes raw authorization headers or structured credentials", async () => {
    const repository = new Gate1PublicProofRepository({
      loadLiveProof: async () => {
        throw new Error([
          "Authorization: Bearer sk-live-123",
          "Authorization: Basic dXNlcjpwYXNz",
          "X-API-Key: key-456",
          '{"authorization":"Bearer json-token","client_secret":"json-secret"}',
        ].join(" "));
      },
    });

    const proof = await new GetPublicJobProof(repository).execute({ jobId: "514" });
    expect(proof.live.error).toEqual({
      code: "GATE1_PROOF_READ_FAILED",
      message: "Gate 1 proof verification did not complete successfully.",
    });
    expect(JSON.stringify(proof)).not.toMatch(/sk-live|dXNlcjpwYXNz|key-456|json-token|json-secret/);
  });

  it("preserves a live mismatch as a distinct public state", async () => {
    const mismatch = verifiedLiveProof();
    mismatch.status = "mismatch";
    mismatch.checks.stateMatches = false;
    const repository = new Gate1PublicProofRepository({ loadLiveProof: async () => mismatch });

    await expect(new GetPublicJobProof(repository).execute({ jobId: "514" })).resolves.toMatchObject({
      live: {
        status: "mismatch",
        checks: { stateMatches: false },
      },
    });
  });

  it("does not perform an RPC read for an unknown job", async () => {
    const loadLiveProof = vi.fn(async () => verifiedLiveProof());
    const useCase = new GetPublicJobProof(new Gate1PublicProofRepository({ loadLiveProof }));
    await expect(useCase.execute({ jobId: "515" })).rejects.toBeInstanceOf(PublicJobProofNotFoundError);
    expect(loadLiveProof).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent reads and caches live evidence for 60 seconds", async () => {
    let now = 0;
    const loadLiveProof = vi.fn(async () => verifiedLiveProof());
    const useCase = new GetPublicJobProof(new Gate1PublicProofRepository({
      loadLiveProof,
      now: () => now,
    }));

    await Promise.all([
      useCase.execute({ jobId: "514" }),
      useCase.execute({ jobId: "514" }),
    ]);
    expect(loadLiveProof).toHaveBeenCalledTimes(1);

    now = 59_999;
    await useCase.execute({ jobId: "514" });
    expect(loadLiveProof).toHaveBeenCalledTimes(1);

    now = 60_000;
    await useCase.execute({ jobId: "514" });
    expect(loadLiveProof).toHaveBeenCalledTimes(2);
  });

  it.each(["", "0", "-1", "0514", "514.0", "abc"])(
    "rejects the invalid job identifier %j before accessing data",
    async (jobId) => {
      const loadLiveProof = vi.fn(async () => verifiedLiveProof());
      const useCase = new GetPublicJobProof(new Gate1PublicProofRepository({ loadLiveProof }));
      await expect(useCase.execute({ jobId })).rejects.toBeInstanceOf(InvalidPublicJobProofIdError);
      expect(loadLiveProof).not.toHaveBeenCalled();
    },
  );
});
