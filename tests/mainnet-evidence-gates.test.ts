import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { assertMainnetEvidenceTransaction } from "../src/mainnet/capture-job-proof-cli.js";
import {
  ERC8183_MAINNET,
  mainnetCommerceEvidenceAbi,
  mainnetTokenEvidenceAbi,
} from "../src/mainnet/contracts.js";
import { assertRegistrationDecision } from "../src/mainnet/grid-seller-cli.js";
import type { MainnetGoNoGoReport } from "../src/mainnet/go-no-go.js";

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
