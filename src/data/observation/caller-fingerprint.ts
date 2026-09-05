import { createHmac } from "node:crypto";

// Opaque per-caller key for the Worker's daily budgets. The request context
// (first forwarded address and origin) never leaves the marketplace: only the
// HMAC of it, keyed by the shared buyer-observation secret, is forwarded, and
// each purpose has its own prefix so two budgets never share a bucket.
export function callerFingerprint(
  purpose: "catalog-validation-caller" | "hire-event-caller" | "quote-request-caller",
  caller: string | undefined,
  secret: string,
): string {
  const context = caller?.trim().slice(0, 512) || "anonymous";
  return createHmac("sha256", secret)
    .update(`${purpose}\0`)
    .update(context)
    .digest("hex");
}
