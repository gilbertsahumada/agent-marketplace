import { getAddress } from "viem";

export const ERC8183_MAINNET = Object.freeze({
  chainId: 56,
  networkName: "BNB Smart Chain",
  rpcUrl: "https://bsc-dataseed.bnbchain.org",
  explorerUrl: "https://bscscan.com",
  registry: getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
  commerce: getAddress("0xEa4DAa3100A767e86FDed867729ae7446476EBA6"),
  commerceImplementation: getAddress("0xd5f9b570c96b5d67702d508c0bfb8b3b09209787"),
  router: getAddress("0x51895229E12F9876011789B04f8698af06cCD6DA"),
  routerImplementation: getAddress("0xf0cf8f47e5c035f16247ff16e9f367e477ee5007"),
  policy: getAddress("0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5"),
  token: getAddress("0xcE24439F2D9C6a2289F741120FE202248B666666"),
  maximumDemoBudgetRaw: 10_000_000_000_000_000n,
} as const);

export const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
