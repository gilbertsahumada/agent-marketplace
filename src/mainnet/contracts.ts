import { getAddress, parseAbi } from "viem";

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

// Minimal official APEX/ERC-8183 signatures used to bind published evidence
// to one exact lifecycle instead of trusting user-supplied transaction hashes.
export const mainnetCommerceEvidenceAbi = parseAbi([
  "event BudgetSet(uint256 indexed jobId, uint256 amount)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256 jobId)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
]);

export const mainnetRouterEvidenceAbi = parseAbi([
  "event JobRegistered(uint256 indexed jobId, address indexed policy, address indexed client)",
  "event JobSettled(uint256 indexed jobId, address indexed policy, uint8 indexed verdict, bytes32 reason)",
  "function registerJob(uint256 jobId, address policy)",
  "function settle(uint256 jobId, bytes evidence)",
]);

export const mainnetTokenEvidenceAbi = parseAbi([
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
