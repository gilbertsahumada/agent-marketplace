import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  assertMainnetEvidenceTransaction,
  assertMainnetLifecycleImplementationPins,
  assertMainnetProofBinding,
} from "../src/mainnet/capture-job-proof-cli.ts";
import {
  ERC8183_MAINNET,
  mainnetCommerceEvidenceAbi,
  mainnetTokenEvidenceAbi,
} from "../src/mainnet/contracts.ts";
import { assertRegistrationDecision } from "../src/mainnet/grid-seller-cli.ts";
import type { MainnetGoNoGoReport } from "../src/mainnet/go-no-go.ts";
import { GRID_CANONICAL_INPUT, GRID_NEGOTIATION_TERMS, gridTaskDescription } from "../src/business/policies/grid-plan-policy.ts";
import { resolveIdentity } from "../src/identity.ts";

const BUYER = getAddress("0x1111111111111111111111111111111111111111");
const SELLER = getAddress("0x2222222222222222222222222222222222222222");
const JOB_ID = 42n;
const BUDGET = ERC8183_MAINNET.maximumDemoBudgetRaw;
const DELIVERABLE = `0x${"33".repeat(32)}` as Hex;

function goReport(generatedAt = "2026-08-24T12:00:00.000Z"): MainnetGoNoGoReport {
  const passed = (observed: string) => ({
    passed: true,
    expected: observed,
    observed,
    provenance: "onchain:bsc-rpc" as const,
  });
  return {
    schemaVersion: 1,
    generatedAt,
    status: "go",
    chainId: 56,
    blockNumber: "117",
    spendCeilingRaw: BUDGET.toString(),
    checks: {
      chain: passed("56"),
      dedicatedSellerAddress: passed(SELLER),
      productionSellerOrigin: { ...passed("https://bnb-agent-marketplace-ruby.vercel.app"), provenance: "operator:public-config" },
      paymentToken: passed(ERC8183_MAINNET.token),
      policyAllowlisted: passed("true"),
      commerceImplementation: passed(ERC8183_MAINNET.commerceImplementation),
      routerImplementation: passed(ERC8183_MAINNET.routerImplementation),
    },
    reasons: [],
    warnings: [],
  };
}

const job = {
  jobId: JOB_ID,
  buyer: BUYER,
  seller: SELLER,
  description: "signed Grid description",
  deadline: 2_000_000_000n,
  budget: BUDGET,
  deliverable: DELIVERABLE,
};

describe("Mainnet registration decision", () => {
  it("binds a fresh GO to the exact active seller and rejects future or edited reports", () => {
    const now = Date.parse("2026-08-24T12:01:00.000Z");
    const config = { address: SELLER, origin: "https://bnb-agent-marketplace-ruby.vercel.app" };
    expect(() => assertRegistrationDecision(goReport(), config, now)).not.toThrow();
    expect(() => assertRegistrationDecision(goReport("2026-08-24T12:02:01.000Z"), config, now)).toThrow(/time window/);
    expect(() => assertRegistrationDecision(goReport(), { ...config, address: BUYER }, now)).toThrow(/not bound/);
    const edited = goReport();
    edited.checks.policyAllowlisted = { ...edited.checks.policyAllowlisted!, passed: false };
    expect(() => assertRegistrationDecision(edited, config, now)).toThrow(/not bound/);
  });
});

describe("Mainnet proof transaction binding", () => {
  it("accepts only an exact approval from the buyer with its confirmed event", () => {
    const transaction = {
      from: BUYER,
      to: ERC8183_MAINNET.token,
      input: encodeFunctionData({
        abi: mainnetTokenEvidenceAbi,
        functionName: "approve",
        args: [ERC8183_MAINNET.commerce, BUDGET],
      }),
    };
    const receipt = {
      status: "success" as const,
      logs: [{
        address: ERC8183_MAINNET.token,
        topics: encodeEventTopics({
          abi: mainnetTokenEvidenceAbi,
          eventName: "Approval",
          args: { owner: BUYER, spender: ERC8183_MAINNET.commerce },
        }) as unknown as Hex[],
        data: encodeAbiParameters([{ type: "uint256" }], [BUDGET]),
      }],
    };
    expect(() => assertMainnetEvidenceTransaction({ phase: "approve", transaction, receipt, job })).not.toThrow();
    expect(() => assertMainnetEvidenceTransaction({ phase: "approve", transaction: { ...transaction, from: SELLER }, receipt, job })).toThrow(/sender/);
    expect(() => assertMainnetEvidenceTransaction({ phase: "approve", transaction, receipt: { ...receipt, logs: [] }, job })).toThrow(/lifecycle event/);
  });

  it("rejects a successful fund transaction whose event belongs to another job", () => {
    const transaction = {
      from: BUYER,
      to: ERC8183_MAINNET.commerce,
      input: encodeFunctionData({
        abi: mainnetCommerceEvidenceAbi,
        functionName: "fund",
        args: [JOB_ID, BUDGET, "0x"],
      }),
    };
    const fundedLog = (jobId: bigint) => ({
      address: ERC8183_MAINNET.commerce,
      topics: encodeEventTopics({
        abi: mainnetCommerceEvidenceAbi,
        eventName: "JobFunded",
        args: { jobId, client: BUYER, provider: SELLER },
      }) as unknown as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [BUDGET]),
    });
    const receipt = { status: "success" as const, logs: [fundedLog(JOB_ID)] };
    expect(() => assertMainnetEvidenceTransaction({ phase: "fund", transaction, receipt, job })).not.toThrow();
    expect(() => assertMainnetEvidenceTransaction({ phase: "fund", transaction, receipt: { ...receipt, logs: [fundedLog(JOB_ID + 1n)] }, job })).toThrow(/lifecycle event/);
  });
});

describe("Mainnet proof deployment binding", () => {
  const description = {
    version: 1,
    chain_id: 56,
    verifying_contract: ERC8183_MAINNET.commerce,
    task: gridTaskDescription(GRID_CANONICAL_INPUT),
    terms: {
      deliverables: GRID_NEGOTIATION_TERMS.deliverables,
      quality_standards: GRID_NEGOTIATION_TERMS.qualityStandards,
    },
  };
  const proofJob = {
    chainId: 56 as const,
    jobId: JOB_ID.toString(),
    buyer: BUYER,
    provider: SELLER,
    evaluator: ERC8183_MAINNET.router,
    policy: ERC8183_MAINNET.policy,
    description: JSON.stringify(description),
    budgetRaw: BUDGET.toString(),
    deadline: "2000000000",
    status: "COMPLETED" as const,
    submittedAt: "1999999000",
    deliverableHash: DELIVERABLE,
    deliverableUrl: null,
    result: null,
    quotedToken: ERC8183_MAINNET.token,
    quotedPriceRaw: BUDGET.toString(),
    quoteExpiresAt: 1_900_000_000,
  };
  const binding = {
    job: proofJob,
    description,
    identity: {
      agentId: 9001,
      agentWallet: SELLER,
      a2aEndpoint: "https://bnb-agent-marketplace-ruby.vercel.app/grid",
    },
    expectedAgentId: 9001,
    expectedSeller: SELLER,
    expectedOrigin: "https://bnb-agent-marketplace-ruby.vercel.app",
    signatureValid: true,
  };

  it("rejects jobs not bound to the exact seller, token, budget, signature and Agent ID", () => {
    expect(() => assertMainnetProofBinding(binding)).not.toThrow();
    expect(() => assertMainnetProofBinding({ ...binding, expectedSeller: BUYER })).toThrow(/allowlist/);
    expect(() => assertMainnetProofBinding({ ...binding, signatureValid: false })).toThrow(/signature/);
    expect(() => assertMainnetProofBinding({
      ...binding,
      job: { ...proofJob, quotedToken: BUYER },
    })).toThrow(/allowlist/);
    expect(() => assertMainnetProofBinding({
      ...binding,
      job: { ...proofJob, budgetRaw: (BUDGET + 1n).toString() },
    })).toThrow(/allowlist/);
    expect(() => assertMainnetProofBinding({
      ...binding,
      identity: { ...binding.identity, agentWallet: BUYER },
    })).toThrow(/Agent ID/);
  });

  it("resolves the Agent ID at funding rather than accepting a later identity update", async () => {
    const fundingBlock = 100n;
    const metadataUri = (endpoint: string) => `data:application/json;base64,${Buffer.from(JSON.stringify({
      name: "Grid seller",
      description: "Historical identity fixture",
      services: [{ name: "A2A", endpoint, version: "0.3.0" }],
    })).toString("base64")}`;
    const readContract = vi.fn(async (request: { functionName: string; blockNumber?: bigint }) => {
      const historical = request.blockNumber === fundingBlock;
      if (request.functionName === "ownerOf") return historical ? BUYER : SELLER;
      if (request.functionName === "getAgentWallet") return historical ? BUYER : SELLER;
      return metadataUri(historical
        ? "https://historical.example/grid"
        : "https://bnb-agent-marketplace-ruby.vercel.app/grid");
    });
    const client = { getChainId: vi.fn(async () => 56), readContract } as never;

    const current = await resolveIdentity(client, 9001, {
      chainId: 56,
      registry: ERC8183_MAINNET.registry,
    });
    const historical = await resolveIdentity(client, 9001, {
      chainId: 56,
      registry: ERC8183_MAINNET.registry,
      blockNumber: fundingBlock,
    });

    expect(current.agentWallet).toBe(SELLER);
    expect(historical.agentWallet).toBe(BUYER);
    expect(readContract.mock.calls.slice(-3).every(([request]) => request.blockNumber === fundingBlock)).toBe(true);
    expect(() => assertMainnetProofBinding({ ...binding, identity: current })).not.toThrow();
    expect(() => assertMainnetProofBinding({ ...binding, identity: historical })).toThrow(/Agent ID/);
  });

  it("rejects an invalid intermediate implementation block and deduplicates shared blocks", async () => {
    const pinsMatch = vi.fn(async (_client: unknown, blockNumber?: bigint) => blockNumber !== 102n);
    const phaseBlocks = {
      createJob: 100n,
      registerJob: 100n,
      setBudget: 102n,
      fund: 103n,
      submit: 104n,
      settle: 105n,
    };

    await expect(assertMainnetLifecycleImplementationPins({} as never, phaseBlocks, pinsMatch as never))
      .rejects.toThrow(/unallowlisted/);
    expect(pinsMatch.mock.calls.map(([, blockNumber]) => blockNumber)).toEqual([100n, 102n, 103n, 104n, 105n]);
  });
});
