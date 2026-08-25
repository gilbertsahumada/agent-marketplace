import { bsc, bscTestnet } from "wagmi/chains";

export const SUPPORTED_CHAINS = [bsc, bscTestnet] as const;

export const SUPPORTED_CHAIN_IDS = [bsc.id, bscTestnet.id] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function isSupportedChainId(chainId: number | undefined): chainId is SupportedChainId {
  return chainId === bsc.id || chainId === bscTestnet.id;
}

export function chainShortName(chainId: number): string {
  if (chainId === bsc.id) return "BSC Mainnet";
  if (chainId === bscTestnet.id) return "BSC Testnet";
  return `Chain ${chainId}`;
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
