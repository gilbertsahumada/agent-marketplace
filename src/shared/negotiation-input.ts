/** A deliberately bounded JSON Schema subset. Unknown constraints fail closed. */
export const NEGOTIATION_INPUT_EXTENSION = "https://marketplace.trust8004.xyz/extensions/negotiation-input/v1";
export interface InputSchema {
  type: "object" | "string" | "integer" | "number" | "boolean";
  title?: string;
  description?: string;
  properties?: Record<string, InputSchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: Array<string | number | boolean>;
  const?: string | number | boolean;
  examples?: unknown[];
}
export interface NegotiationContract {
  provenance?: { profile: "bnb-sdk-v1" | "seller-schema"; source: "a2a-declaration" | "openapi" | "manifest" | "mcp-schema"; detectorVersion: number };
  capabilityProbeParameters?: Record<string, unknown>;
  encoding: "prefixed-json" | "request";
  inputSchema: InputSchema;
  taskDescriptionPrefix?: string;
  terms?: Record<string, unknown>;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function fail(): never { throw new Error("NEGOTIATION_SCHEMA_UNSUPPORTED"); }
const allowed = new Set(["type", "title", "description", "properties", "required", "additionalProperties", "minimum", "maximum", "minLength", "maxLength", "pattern", "enum", "const", "$schema", "examples"]);
function schema(value: unknown, depth = 0, budget = { fields: 0 }): InputSchema {
  if (!record(value) || depth > 3 || ++budget.fields > 32 || Object.keys(value).some(key => !allowed.has(key))) return fail();
  if (!["object", "string", "integer", "number", "boolean"].includes(String(value.type))) return fail();
  const result: InputSchema = { type: value.type as InputSchema["type"] };
  for (const key of ["title", "description"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || value[key].length > 500) return fail();
      result[key] = value[key];
    }
  }
  if (value.type === "object") {
    if (!record(value.properties) || !Object.keys(value.properties).length || (value.additionalProperties !== undefined && value.additionalProperties !== false)) return fail();
    const entries = Object.entries(value.properties);
    if (entries.some(([key]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key))) return fail();
    result.properties = Object.fromEntries(entries.map(([key, child]) => [key, schema(child, depth + 1, budget)]));
    if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some(key => typeof key !== "string" || !Object.hasOwn(value.properties as object, key)))) return fail();
    result.required = (value.required ?? []) as string[];
  }
  for (const key of ["minimum", "maximum", "minLength", "maxLength"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) return fail();
      if (key.endsWith("Length") && (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 1500)) return fail();
      result[key] = value[key];
    }
  }
  if (value.pattern !== undefined) {
    // No groups, alternation, lookarounds, backreferences or wildcards. Bounded
    // input plus this restricted grammar avoids running arbitrary seller regexes.
    if (typeof value.pattern !== "string" || value.pattern.length > 128
      || !/^\^\[[A-Za-z0-9-]+\]\{\d{1,3}(?:,\d{1,3})?\}(?:\/\[[A-Za-z0-9-]+\]\{\d{1,3}(?:,\d{1,3})?\})?\$$/.test(value.pattern)) return fail();
    try { new RegExp(value.pattern); } catch { return fail(); }
    result.pattern = value.pattern;
  }
  for (const key of ["enum", "const"] as const) {
    if (value[key] === undefined) continue;
    const values = key === "enum" ? value[key] : [value[key]];
    if (!Array.isArray(values) || !values.length || values.length > 20 || values.some(v => !["string", "number", "boolean"].includes(typeof v) || String(v).length > 500)) return fail();
    if (key === "enum") result.enum = values;
    else result.const = values[0];
  }
  if (Array.isArray(value.examples)) {
    const examples = value.examples.slice(0, 3).filter(example => validateParameters(result, example));
    if (examples.length) result.examples = examples;
  }
  return result;
}
export function normalizeNegotiationContract(value: unknown): NegotiationContract {
  if (!record(value)) return fail();
  const inputSchema = schema(value.inputSchema);
  if (inputSchema.type !== "object") return fail();
  const sample = value.capabilityProbeParameters;
  if (sample !== undefined && (!record(sample) || !validateParameters(inputSchema, sample))) return fail();
  const probe = { ...(sample === undefined ? {} : { capabilityProbeParameters: sample as Record<string, unknown> }),
    ...(record(value.provenance) && ["bnb-sdk-v1", "seller-schema"].includes(String(value.provenance.profile))
      && ["a2a-declaration", "openapi", "manifest", "mcp-schema"].includes(String(value.provenance.source))
      && value.provenance.detectorVersion === 2 ? { provenance: value.provenance as unknown as NonNullable<NegotiationContract["provenance"]> } : {}),
  };
  if (value.encoding === "request") {
    if (inputSchema.properties?.task_description?.type !== "string" || inputSchema.properties?.terms?.type !== "object"
      || !["task_description", "terms"].every(key => inputSchema.required?.includes(key))
      || Object.keys(inputSchema.properties).some(key => !["task_description", "terms"].includes(key))) return fail();
    const termsSchema = inputSchema.properties.terms;
    const properties = termsSchema.properties ?? {};
    const canonicalKeys = ["deliverables", "quality_standards", "evaluation_required", "evaluator_type"];
    // Compatibility must be established even when the seller publishes no probe
    // example. A schema accepting arbitrary terms is not a canonical quote API.
    if (["deliverables", "quality_standards"].some(key => !properties[key])
      || termsSchema.required?.some(key => !canonicalKeys.includes(key))
      || termsSchema.const !== undefined || termsSchema.enum !== undefined
      || !acceptsCanonicalText(inputSchema.properties.task_description, 1500)
      || !acceptsCanonicalText(properties.deliverables!, 500)
      || !acceptsCanonicalText(properties.quality_standards!, 500)
      || (properties.evaluation_required !== undefined && !validateParameters(properties.evaluation_required, true))
      || (properties.evaluator_type !== undefined && !validateParameters(properties.evaluator_type, "uma_oov3"))) return fail();
    const contract: NegotiationContract = { encoding: "request", inputSchema, ...probe };
    if (contract.capabilityProbeParameters) buildContractRequest(contract, contract.capabilityProbeParameters);
    return contract;
  }
  if (typeof value.taskDescriptionPrefix !== "string" || !/^[A-Z][A-Z0-9_]{0,63}:$/.test(value.taskDescriptionPrefix) || !validTerms(value.terms)) return fail();
  const contract: NegotiationContract = { encoding: "prefixed-json", inputSchema, taskDescriptionPrefix: value.taskDescriptionPrefix, terms: value.terms, ...probe };
  if (contract.capabilityProbeParameters) buildContractRequest(contract, contract.capabilityProbeParameters);
  return contract;
}
function acceptsCanonicalText(input: InputSchema, limit: number): boolean {
  if (input.type !== "string" || Math.max(1, input.minLength ?? 0) > Math.min(limit, input.maxLength ?? limit)) return false;
  const choices = input.const !== undefined ? [input.const] : input.enum;
  return !choices || choices.some(value => typeof value === "string" && !!value.trim() && value.length <= limit && validateParameters(input, value));
}
function validTerms(value: unknown): value is Record<string, unknown> {
  return record(value) && Object.keys(value).every(key => ["deliverables", "quality_standards", "evaluation_required", "evaluator_type"].includes(key))
    && [value.deliverables, value.quality_standards].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 500)
    && (value.evaluation_required === undefined || value.evaluation_required === true)
    && (value.evaluator_type === undefined || value.evaluator_type === "uma_oov3");
}
export function validateParameters(schema: InputSchema, value: unknown): boolean {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value as never)) return false;
  if (schema.type === "object") return record(value)
    && Object.keys(value).every(key => Object.hasOwn(schema.properties ?? {}, key))
    && (schema.required ?? []).every(key => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, child]) => validateParameters(schema.properties![key]!, child));
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "string") return typeof value === "string" && value.length <= Math.min(schema.maxLength ?? 1500, 1500)
    && value.length >= (schema.minLength ?? 0) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  return typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isSafeInteger(value))
    && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
}
function stable(value: unknown): string {
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function buildContractRequest(contract: NegotiationContract, parameters: unknown): { task_description: string; terms: Record<string, unknown> } {
  if (!validateParameters(contract.inputSchema, parameters)) throw new Error("NEGOTIATION_PARAMETERS_INVALID");
  const request = contract.encoding === "request" ? parameters as Record<string, unknown>
    : { task_description: contract.taskDescriptionPrefix! + stable(parameters), terms: contract.terms };
  if (typeof request.task_description !== "string" || !request.task_description.trim() || request.task_description.length > 1500 || !validTerms(request.terms)) throw new Error("NEGOTIATION_PARAMETERS_INVALID");
  return { task_description: request.task_description, terms: request.terms };
}
