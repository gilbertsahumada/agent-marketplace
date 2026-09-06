import { formatUnits } from "viem";

/** Keep integer precision when presenting an on-chain token amount. */
export function formatTokenAmount(raw: string, decimals: number): string {
  return formatUnits(BigInt(raw), decimals);
}
