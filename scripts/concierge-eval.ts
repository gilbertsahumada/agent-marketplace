// Manual eval for the concierge: runs a fixed set of prompts through the real
// model and checks the shape and copy of each reply. Not part of the test
// suite (it calls a real upstream) — run by hand with a real key:
//   CONCIERGE_API_KEY=... npm run concierge:eval
// The npm script runs this under `tsx --conditions=react-server` so that
// importing src/business/composition.ts (which pulls in modules guarded by
// `import "server-only"`) resolves to the package's no-op `react-server`
// export instead of throwing.
import { BANNED_COPY, type ConciergeReply } from "../src/business/entities/concierge.ts";

export interface ConciergeEvalExpectations {
  expectBrief: boolean;
  expectProposal: boolean;
  expectQuestion?: boolean;
  // Only checked for prompts that pin exact values (the clear grid cases):
  // proposal.parameters[key] must equal value.
  expectedParameters?: Record<string, unknown>;
}

export interface ConciergeEvalCase {
  id: string;
  language: "es" | "en";
  prompt: string;
  expectations: ConciergeEvalExpectations;
}

export interface ConciergeEvalJudgement {
  pass: boolean;
  reasons: string[];
}

const MAX_STEPS = 6;
const MAX_ELAPSED_MS = 40_000;

// 12 fixed prompts, 6 Spanish / 6 English, covering the same six situations
// in both languages: a clear grid request (pair, range, capital, levels), a
// grid request missing the range, a request outside the catalog, a request
// for guaranteed profit, a price question, and a request to compare agents.
export const EVAL_CASES: ConciergeEvalCase[] = [
  {
    id: "grid-clear-es",
    language: "es",
    prompt:
      "Quiero un grid trading bot para el par BNB/USDT, entre 550 y 650, con 2000 USDT de capital y 20 niveles.",
    expectations: {
      expectBrief: true,
      expectProposal: true,
      expectQuestion: false,
      expectedParameters: { pair: "BNB/USDT", gridCount: 20 },
    },
  },
  {
    id: "grid-clear-en",
    language: "en",
    prompt:
      "I want a grid trading bot for BNB/USDT, between 550 and 650, with 2000 USDT capital and 20 grid levels.",
    expectations: {
      expectBrief: true,
      expectProposal: true,
      expectQuestion: false,
      expectedParameters: { pair: "BNB/USDT", gridCount: 20 },
    },
  },
  {
    id: "grid-no-range-es",
    language: "es",
    prompt: "Necesito un bot de grid para BNB/USDT con 1000 USDT, no sé qué rango de precios usar.",
    expectations: { expectBrief: true, expectProposal: false, expectQuestion: true },
  },
  {
    id: "grid-no-range-en",
    language: "en",
    prompt: "I need a grid bot for BNB/USDT with 1000 USDT capital, but I don't know what price range to use.",
    expectations: { expectBrief: true, expectProposal: false, expectQuestion: true },
  },
  {
    id: "outside-catalog-es",
    language: "es",
    prompt: "Escríbeme un poema sobre el atardecer en la playa.",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "outside-catalog-en",
    language: "en",
    prompt: "Write me a poem about sunset at the beach.",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "guarantee-es",
    language: "es",
    prompt: "Quiero un agente que me garantice ganancias todos los días sin importar el mercado.",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "guarantee-en",
    language: "en",
    prompt: "I want an agent that guarantees profit every day no matter the market.",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "price-question-es",
    language: "es",
    prompt: "¿Cuánto cuesta contratar un agente de grid trading?",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "price-question-en",
    language: "en",
    prompt: "How much does it cost to hire a grid trading agent?",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "compare-agents-es",
    language: "es",
    prompt: "Compara el agente de grid trading con el agente de arbitraje y dime cuál es mejor.",
    expectations: { expectBrief: false, expectProposal: false },
  },
  {
    id: "compare-agents-en",
    language: "en",
    prompt: "Compare the grid trading agent with the arbitrage agent and tell me which is better.",
    expectations: { expectBrief: false, expectProposal: false },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Pure: no I/O, so it is exercised directly by unit tests against hand-built
// ConciergeReply fixtures, independent of any real model call.
export function judge(
  reply: ConciergeReply,
  expectations: ConciergeEvalExpectations,
  elapsedMs: number,
): ConciergeEvalJudgement {
  const reasons: string[] = [];

  if (reply.message.trim().length === 0) {
    reasons.push("message is empty");
  } else if (BANNED_COPY.test(reply.message)) {
    reasons.push("message contains banned copy");
  }
  if (reply.question && BANNED_COPY.test(reply.question)) {
    reasons.push("question contains banned copy");
  }

  if (expectations.expectBrief && !reply.brief) {
    reasons.push("expected a brief but none was returned");
  }

  if (expectations.expectQuestion === true && !reply.question) {
    reasons.push("expected a clarifying question but none was returned");
  }
  if (expectations.expectQuestion === false && reply.question) {
    reasons.push("did not expect a clarifying question but one was returned");
  }

  if (expectations.expectProposal) {
    const proposal = reply.proposal;
    if (!proposal) {
      reasons.push("expected a proposal but none was returned");
    } else {
      if (typeof proposal.agentId !== "string" || proposal.agentId.trim().length === 0) {
        reasons.push("proposal is missing a valid agentId");
      }
      if (typeof proposal.contractHash !== "string" || proposal.contractHash.trim().length === 0) {
        reasons.push("proposal is missing a contract hash");
      }
      if (!isPlainObject(proposal.parameters)) {
        reasons.push("proposal parameters are not an object");
      }
      if (
        !Array.isArray(proposal.fields) ||
        proposal.fields.length === 0 ||
        proposal.fields.some(
          (field) =>
            typeof field.key !== "string" ||
            field.key.trim().length === 0 ||
            typeof field.title !== "string" ||
            typeof field.value !== "string",
        )
      ) {
        reasons.push("proposal display fields are missing or malformed");
      }
      if (expectations.expectedParameters) {
        for (const [key, value] of Object.entries(expectations.expectedParameters)) {
          if (!isPlainObject(proposal.parameters) || proposal.parameters[key] !== value) {
            reasons.push(`proposal parameter "${key}" did not match the expected value`);
          }
        }
      }
    }
  }

  if (reply.steps.length > MAX_STEPS) {
    reasons.push(`too many steps (${reply.steps.length} > ${MAX_STEPS})`);
  }

  if (elapsedMs >= MAX_ELAPSED_MS) {
    reasons.push(`too slow (${elapsedMs}ms >= ${MAX_ELAPSED_MS}ms)`);
  }

  return { pass: reasons.length === 0, reasons };
}

const MAX_ALLOWED_FAILURES = 2;

async function main(): Promise<void> {
  const apiKey = process.env.CONCIERGE_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set CONCIERGE_API_KEY before running the concierge eval (npm run concierge:eval).");
    process.exitCode = 2;
    return;
  }

  const { askConcierge } = await import("../src/business/composition.ts");

  const rows: Array<{ id: string; pass: boolean; ms: number; reasons: string[] }> = [];
  for (const evalCase of EVAL_CASES) {
    const startedAt = Date.now();
    let judgement: ConciergeEvalJudgement;
    let elapsedMs: number;
    try {
      const reply = await askConcierge.execute({
        messages: [{ role: "user", content: evalCase.prompt }],
        // Distinct caller per case: the real InProcessConciergeAdmission
        // rate-limits per caller (6 admits / 60s), and all 12 cases sharing
        // one caller id would throttle cases 7-12 whenever the run is fast.
        caller: `concierge-eval:${evalCase.id}`,
      });
      elapsedMs = Date.now() - startedAt;
      judgement = judge(reply, evalCase.expectations, elapsedMs);
    } catch (error) {
      elapsedMs = Date.now() - startedAt;
      judgement = { pass: false, reasons: [`execute threw: ${error instanceof Error ? error.message : "unknown error"}`] };
    }
    rows.push({ id: evalCase.id, pass: judgement.pass, ms: elapsedMs, reasons: judgement.reasons });
  }

  const idWidth = Math.max(...rows.map((row) => row.id.length));
  for (const row of rows) {
    const status = row.pass ? "PASS" : "FAIL";
    const line = `${row.id.padEnd(idWidth)}  ${status}  ${String(row.ms).padStart(6)}ms`;
    console.log(row.reasons.length > 0 ? `${line}  ${row.reasons.join("; ")}` : line);
  }

  const passed = rows.filter((row) => row.pass).length;
  const failed = rows.length - passed;
  console.log(`passed ${passed}/${rows.length}`);

  if (failed > MAX_ALLOWED_FAILURES) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main();
}
