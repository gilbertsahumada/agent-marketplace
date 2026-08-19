import { getAddress, parseAbi } from "viem";

export const ERC8183_TESTNET = Object.freeze({
  chainId: 97,
  networkName: "BSC Testnet",
  rpcUrl: "https://data-seed-prebsc-2-s2.binance.org:8545",
  explorerUrl: "https://testnet.bscscan.com",
  agentId: 1815,
  registry: getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
  commerce: getAddress("0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de"),
  router: getAddress("0xd7d36d66d2f1b608a0f943f722d27e3744f66f25"),
  policy: getAddress("0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA"),
  token: getAddress("0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"),
  seller: getAddress("0xa0166a1c586f85Db39798ee311BAA7831C4Dc65b"),
  hostedSeller: getAddress("0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5"),
  maximumBudgetRaw: 1n,
} as const);

// Minimal signatures adapted from the generated official @bnbagent/sdk ABIs.
export const agenticCommerceBrowserAbi = parseAbi([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256 jobId)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
]);

export const evaluatorRouterBrowserAbi = parseAbi([
  "function registerJob(uint256 jobId, address policy)",
]);

export const paymentTokenBrowserAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
