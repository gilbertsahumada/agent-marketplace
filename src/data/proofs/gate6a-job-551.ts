import type { PublicJobProofSnapshotRecord } from "./public-job-proof-record.js";

const EXPLORER = "https://testnet.bscscan.com/tx";

export const GATE6A_JOB_551_MANIFEST = {
  schemaVersion: 1,
  source: "snapshot:gate6a-job-551",
  recordedAt: "2026-08-19T20:22:18.000Z",
  network: "bsc-testnet",
  chainId: 97,
  jobId: "551",
  sellerAgentId: "1866",
  buyer: "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52",
  seller: "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5",
  sellerEndpoint: "https://bnb-agent-marketplace-ruby.vercel.app",
  contracts: {
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
    router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
    policy: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
  },
  payment: {
    token: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    symbol: "U",
    decimals: 18,
    budgetRaw: "1",
    budgetFormatted: "0.000000000000000001",
  },
  quote: {
    negotiationHash: "0x85fe8236151559dd6dd7db5a01a418dcb04c03b53569ae5286d5fd2775175492",
    negotiatedAt: "2026-08-19T20:07:21.000Z",
    expiresAt: "2026-08-19T20:22:21.000Z",
    signatureVerified: true,
  },
  lifecycle: {
    expectedState: "SUBMITTED",
    deadline: { unix: "1787174546", iso: "2026-08-19T21:22:26.000Z" },
    submittedAt: { unix: "1787170568", iso: "2026-08-19T20:16:08.000Z" },
  },
  deliverable: {
    hash: "0xd7408b31056c749e57bea7a13c35ef463b9c9c9881cebdd20a8609cb2607b834",
    receipt: "deterministic-text",
    availability: "public_hash_verified",
    note: "The hosted deterministic result remains public and is verified against the onchain deliverable hash.",
    url: "https://bnb-agent-marketplace-ruby.vercel.app/api/fixtures/erc8183/job/551/response",
    contentType: "text/plain",
    content: "Hosted ERC-8183 seller fixture completed job 551",
    hashVerified: true,
  },
  transactions: {
    createJob: transaction("0xfeffbbf19d22b3511fbc2f1c848c500c38aa126251a84722de431f9d4a8ceb47", "126052539", "2026-08-19T20:07:42.000Z"),
    registerJob: transaction("0x68305e14b25bb250d7ba4b5d83e20592f5bbd885e83c1e66c99aeda7e93a8cb2", "126052560", "2026-08-19T20:07:52.000Z"),
    setBudget: transaction("0x1712079f88ff27f9e97bc8e116ac5b8e94379197cc3cdfcb306a1f64f45faa65", "126052570", "2026-08-19T20:07:56.000Z"),
    approve: transaction("0x8a6ba5a88949c959bd450d863cbed4a87836fc900db468720dba25ee0c15992a", "126052587", "2026-08-19T20:08:04.000Z"),
    fund: transaction("0xa3172e46a409c08d6596a93677e1c92c13e11010e6134be5a0eb8c74a85c96c3", "126052605", "2026-08-19T20:08:12.000Z"),
    submit: transaction("0x82ea27585e4e5aebb4caedbed8d4c1a9e17e7321db40073bd2ea172e6e57b836", "126053662", "2026-08-19T20:16:08.000Z"),
  },
  fixture: {
    testInfrastructure: true,
    marketplaceAgent: false,
    officialReferenceAgent: false,
  },
  custody: {
    buyerWallet: "injected-eip1193",
    buyerPrivateKeyReceivedByServer: false,
    sellerKeyStorage: "server-side-sensitive-environment-variable",
  },
} as const satisfies PublicJobProofSnapshotRecord;

function transaction(hash: `0x${string}`, blockNumber: string, timestamp: string) {
  return {
    hash,
    status: "success" as const,
    blockNumber,
    timestamp,
    explorerUrl: `${EXPLORER}/${hash}`,
    provenance: "onchain:bsc-testnet" as const,
  };
}
