import { getAddress, zeroAddress, type Address } from "viem";

/** Expected authority comes from the registered identity, never seller metadata.
 * This only resolves the account; callers MUST still verify its signature and
 * fresh chain identity before authorizing a transaction.
 */
export function quoteProvider(metadata: unknown, expected: Address): Address {
  const provider = getAddress(expected);
  if (provider === zeroAddress) throw new Error("QUOTE_PROVIDER");
  if (metadata !== undefined && (typeof metadata !== "string" || getAddress(metadata) !== provider)) throw new Error("QUOTE_PROVIDER");
  return provider;
}
