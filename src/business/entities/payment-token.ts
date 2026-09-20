export type PaymentTokenChainId = 56 | 97;
export type PaymentTokenAddress = `0x${string}`;

export interface PaymentTokenMetadata {
  readonly chainId: PaymentTokenChainId;
  readonly address: PaymentTokenAddress;
  readonly symbol: "U" | "USDC" | "USDT" | "USD1";
  readonly name: string;
  readonly decimals: 18;
  readonly logoUrl: string;
}

const TRUST_WALLET_BSC_ASSETS = "https://assets-cdn.trustwallet.com/blockchains/smartchain/assets";
const U_ADDRESS = "0xcE24439F2D9C6a2289F741120FE202248B666666" as const;
const EVM_ADDRESS = /^0x[\da-f]{40}$/i;

const TOKENS = [
  { chainId: 56, address: U_ADDRESS, symbol: "U", name: "United Stables" },
  { chainId: 56, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", name: "USD Coin" },
  { chainId: 56, address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", name: "Tether USD" },
  { chainId: 56, address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", symbol: "USD1", name: "World Liberty Financial USD" },
  // Testnet U uses the same brand asset as its Mainnet counterpart.
  { chainId: 97, address: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565", symbol: "U", name: "United Stables", assetAddress: U_ADDRESS },
] as const;

export const PAYMENT_TOKENS: readonly PaymentTokenMetadata[] = TOKENS.map((token) => ({
  chainId: token.chainId,
  address: token.address,
  symbol: token.symbol,
  name: token.name,
  decimals: 18,
  logoUrl: `${TRUST_WALLET_BSC_ASSETS}/${"assetAddress" in token ? token.assetAddress : token.address}/logo.png`,
}));

const TOKEN_BY_CHAIN_AND_ADDRESS = new Map(
  PAYMENT_TOKENS.map((token) => [`${token.chainId}:${token.address.toLowerCase()}`, token] as const),
);

export function paymentTokenMetadata(
  chainId: PaymentTokenChainId,
  address: string | null | undefined,
): PaymentTokenMetadata | null {
  if (!address || !EVM_ADDRESS.test(address)) return null;
  return TOKEN_BY_CHAIN_AND_ADDRESS.get(`${chainId}:${address.toLowerCase()}`) ?? null;
}

export function defaultPaymentToken(chainId: PaymentTokenChainId): PaymentTokenMetadata {
  const token = PAYMENT_TOKENS.find((candidate) => candidate.chainId === chainId && candidate.symbol === "U");
  if (!token) throw new Error(`PAYMENT_TOKEN_DEFAULT_MISSING_${chainId}`);
  return token;
}
