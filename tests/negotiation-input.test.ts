import { describe, expect, it } from "vitest";
import { normalizeNegotiationContract, buildContractRequest } from "../src/shared/negotiation-input";

const terms = { deliverables: "A plan", quality_standards: "Deterministic", evaluation_required: true, evaluator_type: "uma_oov3" };
const contract = { taskDescriptionPrefix: "PLAN_V1:", terms, inputSchema: { type: "object", additionalProperties: false, required: ["levels"], properties: { levels: { type: "integer", minimum: 2, maximum: 100 } } } };
describe("seller negotiation contract", () => {
  it.each([
    { budget: { type: "number" } },
    { deliverables: { type: "string" }, quality_standards: { type: "string" }, evaluation_required: { type: "boolean", const: false }, evaluator_type: { type: "string" } },
    { deliverables: { type: "string" }, quality_standards: { type: "string" }, evaluation_required: { type: "boolean" }, evaluator_type: { type: "string", enum: ["other"] } },
  ])("rejects impossible canonical terms without requiring a probe sample: %j", properties => {
    expect(() => normalizeNegotiationContract({ encoding: "request", inputSchema: {
      type: "object", required: ["task_description", "terms"], properties: {
        task_description: { type: "string" }, terms: { type: "object", required: Object.keys(properties), properties },
      },
    } })).toThrow("NEGOTIATION_SCHEMA_UNSUPPORTED");
  });
  it("builds the seller format instead of replacing it with a generic brief", () => {
    const normalized = normalizeNegotiationContract(contract);
    expect(buildContractRequest(normalized, { levels: 9 })).toEqual({ task_description: 'PLAN_V1:{"levels":9}', terms });
  });
  it("rejects absent, unsupported and dangerous schemas rather than guessing", () => {
    for (const schema of [null, { type: "object" }, { $ref: "https://evil.example/schema" }, { type: "string", pattern: "(a+)+$" }]) {
      expect(() => normalizeNegotiationContract({ ...contract, inputSchema: schema })).toThrow();
    }
  });
  it("rejects missing, extra, wrong-type and out-of-range inputs", () => {
    const normalized = normalizeNegotiationContract(contract);
    for (const input of [{}, { levels: 1 }, { levels: "9" }, { levels: 9, extra: true }]) {
      expect(() => buildContractRequest(normalized, input)).toThrow();
    }
  });
  it("supports explicit MCP task_description and terms schemas", () => {
    const normalized = normalizeNegotiationContract({ encoding: "request", inputSchema: {
      type: "object", required: ["task_description", "terms"], properties: {
        task_description: { type: "string", minLength: 1 },
        terms: { type: "object", required: Object.keys(terms), properties: {
          deliverables: { type: "string" }, quality_standards: { type: "string" },
          evaluation_required: { type: "boolean", const: true }, evaluator_type: { type: "string", const: "uma_oov3" },
        } },
      },
    } });
    expect(buildContractRequest(normalized, { task_description: "Research this", terms })).toEqual({ task_description: "Research this", terms });
    // First-time sellers need no historical quote or automatic-probe example.
    expect(normalized.capabilityProbeParameters).toBeUndefined();
    const inputSchema = normalized.inputSchema;
    const termProperties = inputSchema.properties!.terms!.properties!;
    for (const incompatible of [
      { ...termProperties, deliverables: { type: "number" } },
      { ...termProperties, deliverables: { type: "string", maxLength: 0 } },
      { ...termProperties, quality_standards: { type: "string", const: " " } },
      { ...termProperties, quality_standards: { type: "string", minLength: 501 } },
    ]) {
      expect(() => normalizeNegotiationContract({ encoding: "request", inputSchema: { ...inputSchema, properties: {
        ...inputSchema.properties, terms: { type: "object", properties: incompatible },
      } } })).toThrow("NEGOTIATION_SCHEMA_UNSUPPORTED");
    }
    const optional = normalizeNegotiationContract({ encoding: "request", inputSchema: { ...inputSchema, properties: {
      ...inputSchema.properties, terms: { type: "object", properties: { ...termProperties, note: { type: "string" } } },
    } } });
    expect(buildContractRequest(optional, { task_description: "Research this", terms }).terms).toEqual(terms);
  });
});
