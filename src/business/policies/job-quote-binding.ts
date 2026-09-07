import { keccak256, toBytes } from "viem";
import { Erc8183JobNotReadyError } from "../errors/erc8183-spike-errors.ts";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, sorted(entry)]));
  return value;
}

/** Match the SDK's signed description encoding, including ASCII Unicode escapes. */
export function assertJobQuoteBinding(description: string, verifiedNegotiationHash: string | null | undefined): void {
  const fail = () => new Erc8183JobNotReadyError("The job does not match the original verified quote. Do not fund another job.");
  if (!verifiedNegotiationHash || !/^0x[\da-f]{64}$/i.test(verifiedNegotiationHash)) throw fail();
  try {
    const value = JSON.parse(description);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || typeof value.negotiation_hash !== "string" || value.negotiation_hash.toLowerCase() !== verifiedNegotiationHash.toLowerCase()) throw fail();
    const { negotiation_hash: _hash, provider_sig: _signature, ...content } = value;
    const canonical = JSON.stringify(sorted(content)).replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
    if (keccak256(toBytes(canonical)).toLowerCase() !== verifiedNegotiationHash.toLowerCase()) throw fail();
  } catch { throw fail(); }
}
