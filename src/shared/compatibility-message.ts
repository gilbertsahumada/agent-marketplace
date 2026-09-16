/** Public, bounded copy. Never surface provider HTML or raw exception text. */
export function compatibilityMessage(code: string | null | undefined) {
  if (code === "SELLER_ACCESS_DENIED") return { title: "Requirements blocked by provider", detail: "The provider denied access to its requirements. Its operator must enable public access before you can request a quote." };
  if (code === "SELLER_RATE_LIMITED") return { title: "Provider rate limit", detail: "The provider is limiting requests. Try again later." };
  if (code === "NEGOTIATION_PARAMETERS_UNAVAILABLE") return { title: "Quote requirements not published", detail: "The provider has not published the inputs needed to request a quote here. The provider needs to add them; you do not need to change your request or connect a wallet." };
  if (code === "NEGOTIATION_SCHEMA_UNSUPPORTED") return { title: "Quote requirements not supported", detail: "The provider's quote requirements are missing, incomplete or in a format this marketplace cannot read. The provider needs to publish a supported form before you can request a quote here." };
  if (code === "A2A_REQUIRED_SKILLS" || code === "MCP_QUOTE_TOOL_REQUIRED" || code === "NEGOTIATION_TRANSPORT_UNSUPPORTED") return { title: "Quote integration unavailable", detail: "This provider does not expose a supported way to request a quote here. Its operator needs to update the integration. This does not tell us whether the agent can deliver work." };
  if (code === "SELLER_TIMEOUT") return { title: "Provider took too long to respond", detail: "We could not load the provider's quote requirements in time. Try again later; this does not mean the agent is incompatible." };
  return { title: "Requirements check unavailable", detail: "We could not confirm the inputs needed to request a quote. Try again later. This is not a judgment of the agent's work." };
}
