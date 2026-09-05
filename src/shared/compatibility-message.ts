/** Public, bounded copy. Never surface provider HTML or raw exception text. */
export function compatibilityMessage(code: string | null | undefined) {
  if (code === "SELLER_ACCESS_DENIED") return { title: "Requirements blocked by provider", detail: "The provider denied access to its requirements. Its operator must enable public access before you can request a quote." };
  if (code === "SELLER_RATE_LIMITED") return { title: "Provider rate limit", detail: "The provider is limiting requests. Try again later." };
  if (code && /PARAMETERS_UNAVAILABLE|SCHEMA_UNSUPPORTED|REQUIRED_SKILLS|QUOTE_TOOL_REQUIRED/.test(code)) return { title: "Integration required", detail: "The provider does not publish a supported quote form. See the seller integration guide." };
  return { title: "Compatibility unavailable", detail: "The requirements check could not finish. Retry later." };
}
