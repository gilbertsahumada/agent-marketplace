import { describe, expect, it } from "vitest";
import { EVAL_CASES, judge, type ConciergeEvalExpectations } from "../scripts/concierge-eval.ts";
import type { ConciergeReply } from "../src/business/entities/concierge.ts";

const SPANISH_HEURISTIC = /[áéíóúñü¿¡]/i;

function baseReply(overrides: Partial<ConciergeReply> = {}): ConciergeReply {
  return {
    schemaVersion: 1,
    message: "Here is what I found.",
    question: null,
    brief: null,
    agents: [],
    proposal: null,
    steps: [],
    model: "test-model",
    ...overrides,
  };
}

const NO_EXPECTATIONS: ConciergeEvalExpectations = { expectBrief: false, expectProposal: false };

const BRIEF = { objective: "objective", deliverable: "deliverable", acceptanceCriteria: "acceptance" };

const VALID_PROPOSAL = {
  agentId: "303779",
  parameters: { pair: "BNB/USDT", gridCount: 20 },
  contractHash: "0xhash",
  fields: [{ key: "pair", title: "Pair", value: "BNB/USDT" }],
};

describe("judge", () => {
  it("passes a well-formed reply that matches its expectations", () => {
    const reply = baseReply({ brief: BRIEF, proposal: VALID_PROPOSAL, steps: [{ tool: "search_agents", summary: "1 agent" }] });
    const expectations: ConciergeEvalExpectations = {
      expectBrief: true,
      expectProposal: true,
      expectedParameters: { pair: "BNB/USDT", gridCount: 20 },
    };
    expect(judge(reply, expectations, 500)).toEqual({ pass: true, reasons: [] });
  });

  it("fails when the message contains banned copy", () => {
    const reply = baseReply({ message: "We guarantee profit." });
    const result = judge(reply, NO_EXPECTATIONS, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("message contains banned copy");
  });

  it("fails when the question contains banned copy", () => {
    const reply = baseReply({ question: "Do you want a guaranteed outcome?" });
    const result = judge(reply, NO_EXPECTATIONS, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("question contains banned copy");
  });

  it("fails when a brief is expected but missing", () => {
    const reply = baseReply({ brief: null });
    const result = judge(reply, { expectBrief: true, expectProposal: false }, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("expected a brief but none was returned");
  });

  it("fails when a proposal is expected but missing", () => {
    const reply = baseReply({ proposal: null });
    const result = judge(reply, { expectBrief: false, expectProposal: true }, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("expected a proposal but none was returned");
  });

  it("fails when the proposal parameters don't match the expected values", () => {
    const reply = baseReply({ proposal: { ...VALID_PROPOSAL, parameters: { pair: "BNB/USDT", gridCount: 5 } } });
    const result = judge(
      reply,
      { expectBrief: false, expectProposal: true, expectedParameters: { gridCount: 20 } },
      500,
    );
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('proposal parameter "gridCount" did not match the expected value');
  });

  it("fails when the proposal has no display fields", () => {
    const reply = baseReply({ proposal: { ...VALID_PROPOSAL, fields: [] } });
    const result = judge(reply, { expectBrief: false, expectProposal: true }, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("proposal display fields are missing or malformed");
  });

  it("fails when a clarifying question is expected but missing", () => {
    const reply = baseReply({ question: null });
    const result = judge(reply, { expectBrief: false, expectProposal: false, expectQuestion: true }, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("expected a clarifying question but none was returned");
  });

  it("fails when there are more than 6 steps", () => {
    const steps = Array.from({ length: 7 }, () => ({ tool: "search_agents" as const, summary: "step" }));
    const reply = baseReply({ steps });
    const result = judge(reply, NO_EXPECTATIONS, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("too many steps (7 > 6)");
  });

  it("fails when the reply took 40 seconds or more", () => {
    const reply = baseReply();
    const result = judge(reply, NO_EXPECTATIONS, 40_000);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("too slow (40000ms >= 40000ms)");
  });

  it("fails when the message is empty", () => {
    const reply = baseReply({ message: "" });
    const result = judge(reply, NO_EXPECTATIONS, 500);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain("message is empty");
  });
});

describe("EVAL_CASES", () => {
  it("has 12 fixed prompts", () => {
    expect(EVAL_CASES).toHaveLength(12);
  });

  it("has unique ids", () => {
    const ids = new Set(EVAL_CASES.map((evalCase) => evalCase.id));
    expect(ids.size).toBe(EVAL_CASES.length);
  });

  it("splits evenly into 6 Spanish and 6 English prompts", () => {
    const spanish = EVAL_CASES.filter(
      (evalCase) => SPANISH_HEURISTIC.test(evalCase.prompt) || /\b(quiero|necesito)\b/i.test(evalCase.prompt),
    );
    const english = EVAL_CASES.filter(
      (evalCase) => !SPANISH_HEURISTIC.test(evalCase.prompt) && !/\b(quiero|necesito)\b/i.test(evalCase.prompt),
    );
    expect(spanish).toHaveLength(6);
    expect(english).toHaveLength(6);
    expect(spanish.every((evalCase) => evalCase.language === "es")).toBe(true);
    expect(english.every((evalCase) => evalCase.language === "en")).toBe(true);
  });

  it("marks the clear grid cases with the parameters the prompt actually states", () => {
    const clearGridCases = EVAL_CASES.filter((evalCase) => evalCase.id.startsWith("grid-clear-"));
    expect(clearGridCases).toHaveLength(2);
    for (const evalCase of clearGridCases) {
      expect(evalCase.expectations.expectProposal).toBe(true);
      expect(evalCase.expectations.expectedParameters).toEqual({ pair: "BNB/USDT", gridCount: 20 });
    }
  });
});
