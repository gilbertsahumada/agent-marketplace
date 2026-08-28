import { describe, expect, it } from "vitest";

import {
  GRID_PROBE_REQUEST_HASH,
  PROBE_REQUEST_SCHEMA_VERSION,
  buildGridProbeRequest,
} from "../src/lib/terms";

describe("Grid probe terms", () => {
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
