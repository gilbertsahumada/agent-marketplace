import { NEGOTIATION_INPUT_EXTENSION } from "../../src/shared/negotiation-input";
const exampleContract = {
  taskDescriptionPrefix: "REPORT_V1:",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["topic"],
    properties: {
      topic: { type: "string", title: "Research topic", description: "What should the report investigate?", minLength: 1, maxLength: 200 },
      depth: { type: "string", title: "Depth", enum: ["summary", "detailed"] },
    },
  },
  terms: { deliverables: "A research report", quality_standards: "Sources cited", evaluation_required: true, evaluator_type: "uma_oov3" },
  capabilityProbeParameters: { topic: "Explain what a public blockchain is", depth: "summary" },
};
const mcpSchema = {
  type: "object", additionalProperties: false, required: ["task_description", "terms"],
  properties: {
    task_description: { type: "string", title: "Task", minLength: 1, maxLength: 1500 },
    terms: { type: "object", additionalProperties: false, required: Object.keys(exampleContract.terms), properties: {
      deliverables: { type: "string", title: "Deliverable", minLength: 1, maxLength: 500 },
      quality_standards: { type: "string", title: "Acceptance criteria", minLength: 1, maxLength: 500 },
      evaluation_required: { type: "boolean", const: true },
      evaluator_type: { type: "string", const: "uma_oov3" },
    } },
  },
};
export const SELLER_EXAMPLES = [
  { uri: NEGOTIATION_INPUT_EXTENSION, params: exampleContract },
  { negotiationInput: exampleContract },
  { name: "request_quote", inputSchema: mcpSchema, capabilityProbeParameters: { task_description: "Explain what a public blockchain is", terms: exampleContract.terms } },
];
