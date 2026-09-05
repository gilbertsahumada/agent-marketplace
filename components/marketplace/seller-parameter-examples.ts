import { GRID_CANONICAL_INPUT } from "@/src/business/policies/grid-plan-policy";
import { buildContractRequest, validateParameters, type InputSchema, type NegotiationContract } from "@/src/shared/negotiation-input";

function schemaExample(schema: InputSchema): unknown {
  const published = schema.examples?.find(value => validateParameters(schema, value));
  if (published !== undefined) return published;
  if (schema.const !== undefined) return schema.const;
  if (schema.type !== "object") return undefined;
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, field]) => {
    const value = schemaExample(field);
    return value === undefined ? [] : [[key, value]];
  }));
}

export function sellerParameterExample(contract: NegotiationContract): Record<string, unknown> | null {
  const candidates = [contract.capabilityProbeParameters, schemaExample(contract.inputSchema),
    ...(contract.encoding === "prefixed-json" && contract.taskDescriptionPrefix === "GRID_PLAN_V1:" ? [GRID_CANONICAL_INPUT] : [])];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !Object.keys(candidate).length) continue;
    try {
      buildContractRequest(contract, candidate);
      return structuredClone(candidate) as Record<string, unknown>;
    } catch { /* Examples must satisfy the same validation as buyer input. */ }
  }
  return null;
}

export function parameterPlaceholder(field: InputSchema, example?: unknown): string {
  const value = example ?? field.examples?.find(value => validateParameters(field, value));
  if ((typeof value === "string" || typeof value === "number") && validateParameters(field, value)) return `e.g. ${value}`;
  if (field.type === "number" || field.type === "integer") {
    if (field.minimum !== undefined && field.maximum !== undefined) return `${field.minimum}–${field.maximum}`;
    return field.type === "integer" ? "Enter a whole number" : "Enter a number";
  }
  return `Enter ${field.title?.toLowerCase() ?? "a value"}`;
}
