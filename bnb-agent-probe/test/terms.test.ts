import { describe, expect, it } from "vitest";

import {
  GRID_PROBE_REQUEST_HASH,
  PROBE_CATEGORIES,
  PROBE_REQUEST_SCHEMA_VERSION,
  buildBuyerQuoteRequest,
  buildGridProbeRequest,
  buildProbeRequest,
} from "../src/lib/terms";

describe("Grid probe terms", () => {
  it("pins every WP4 category template to its normative hash", () => {
    expect(PROBE_CATEGORIES.map((category) => [
      category,
      buildProbeRequest(category).requestHash,
    ])).toEqual([
      ["rebalancing", "0x30c4d87009384d98601811722a9982fbe95d4efd65b5f891e46937832e9c0288"],
      ["grid_trading", "0x697a15f62a1748230d3e4bdbbe24f6a619d1b82d45f1e4c82787e268ab2497d3"],
      ["yield_optimisation", "0xf932f814bf58850fca34c32d25dc38890041079f75014d4e400bb92d607c9970"],
      ["health_factor_monitoring", "0xb31d452e27e497cb57af53f4f0caa9ed394d1c19acdab34e18aefe4924378ef4"],
    ]);
  });

  it("matches the canonical marketplace request byte-for-byte", () => {
    const request = buildGridProbeRequest();

    expect(PROBE_REQUEST_SCHEMA_VERSION).toBe(1);
    expect(request.toDict()).toEqual({
      task_description: "GRID_PLAN_V1:{\"pair\":\"BNB/USDT\",\"lowerPrice\":\"700\",\"upperPrice\":\"900\",\"capital\":\"1000\",\"gridCount\":9}",
      terms: {
        deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions",
        quality_standards: "Deterministic output, no order execution and no custody",
        evaluation_required: true,
        evaluator_type: "uma_oov3",
      },
    });
    expect(request.computeHash()).toBe(GRID_PROBE_REQUEST_HASH);
    expect(GRID_PROBE_REQUEST_HASH).toBe(
      "0x697a15f62a1748230d3e4bdbbe24f6a619d1b82d45f1e4c82787e268ab2497d3",
    );
  });
});

describe("buyer quote terms", () => {
  it("canonicalizes one structured brief into the same SDK request used by every transport", () => {
    const quote = buildBuyerQuoteRequest({
      objective: "  Compare two strategies  ",
      deliverable: " A JSON recommendation ",
      acceptanceCriteria: " Include assumptions and risks ",
    });

    expect(quote.request.toDict()).toEqual({
      task_description: "MARKETPLACE_QUOTE_V1:{\"objective\":\"Compare two strategies\",\"deliverable\":\"A JSON recommendation\",\"acceptanceCriteria\":\"Include assumptions and risks\"}",
      terms: {
        deliverables: "A JSON recommendation",
        quality_standards: "Include assumptions and risks",
        evaluation_required: true,
        evaluator_type: "uma_oov3",
      },
    });
    expect(quote.requestHash).toBe(quote.request.computeHash().toLowerCase());
  });
});
