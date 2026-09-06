import { normalizeNegotiationContract, type NegotiationContract } from "./negotiation-input.ts";

export const NEGOTIATION_DETECTOR_VERSION = 2;

/** Identifies a documented wire contract, not the seller's installed software.
 * No probe sample: a buyer supplies service-specific text; discovery never signs.
 */
export function sdkNegotiationProfile(): NegotiationContract {
  return normalizeNegotiationContract({
    encoding: "request",
    provenance: { profile: "bnb-sdk-v1", source: "a2a-declaration", detectorVersion: NEGOTIATION_DETECTOR_VERSION },
    inputSchema: { type: "object", additionalProperties: false, required: ["task_description", "terms"], properties: {
      task_description: { type: "string", title: "What do you need?", minLength: 1, maxLength: 1500 },
      terms: { type: "object", title: "Expected result", additionalProperties: false, required: ["deliverables", "quality_standards"], properties: {
        deliverables: { type: "string", title: "Expected deliverable", minLength: 1, maxLength: 500 },
        quality_standards: { type: "string", title: "Acceptance criteria", minLength: 1, maxLength: 500 },
      } },
    } },
  });
}

export function supportsSdkA2aProfile(card: Record<string, unknown>): boolean {
  if (card.protocolVersion !== "0.3.0" || !Array.isArray(card.skills)) return false;
  const capabilities = card.capabilities as { extensions?: Array<{ required?: boolean; uri?: string }> } | undefined;
  // Other published task schemas must not be silently replaced by free text.
  if (capabilities && Array.isArray(capabilities.extensions) && capabilities.extensions.some(extension =>
    extension && (extension.required === true || /schema|input/i.test(String(extension.uri))))) return false;
  const selected = ["negotiate-erc8183-job", "negotiate"].map(id => (card.skills as Array<Record<string, unknown>>).find(skill => skill?.id === id)).find(Boolean);
  return [selected].some(skill => {
    if (!skill || typeof skill !== "object" || !["negotiate-erc8183-job", "negotiate"].includes(String(skill.id))) return false;
    // A bare skill name proves neither its payload nor its quote format.
    const description = typeof skill.description === "string" ? skill.description : "";
    return ["task_description", "terms", "negotiation_hash", "provider_sig"].every(field => new RegExp(`\\b${field}\\b`).test(description));
  });
}
