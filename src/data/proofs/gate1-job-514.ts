import type { PublicJobProofSnapshotRecord } from "./public-job-proof-record.js";

const EXPLORER = "https://testnet.bscscan.com/tx";

export const GATE1_JOB_514_MANIFEST = {
  schemaVersion: 1,
  source: "snapshot:gate1-job-514",
  recordedAt: "2026-08-13T15:55:59.000Z",
  network: "bsc-testnet",
  chainId: 97,
  jobId: "514",
  sellerAgentId: "1815",
  buyer: "0x8bdC9Bc2a2de68715e181b72603Bb9A61eff7ddB",
  seller: "0xa0166a1c586f85Db39798ee311BAA7831C4Dc65b",
  payment: {
    token: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    symbol: "$U",
    decimals: 18,
    budgetRaw: "1",
  },
  lifecycle: {
    expectedState: "SUBMITTED",
    deadline: { unix: "1786640937", iso: "2026-08-13T17:08:57.000Z" },
    submittedAt: { unix: "1786636559", iso: "2026-08-13T15:55:59.000Z" },
  },
  deliverable: {
    hash: "0x2ed47b2d41add5f9cef468b6748a1d52b3d6e753fac9c7e1de14766e6e315066",
    receipt: "deterministic-text",
    availability: "hash_only",
    note: "The temporary HTTPS locator was intentionally retired after verification; only its onchain integrity hash is published here.",
  },
  transactions: {
    createJob: {
      hash: "0x8767e5163c208d18ec4282d2a37c519b29fa03b6f6141e4f0458be8d64a243ce",
      status: "success",
      blockNumber: "124866822",
      timestamp: "2026-08-13T15:54:03.000Z",
      explorerUrl: `${EXPLORER}/0x8767e5163c208d18ec4282d2a37c519b29fa03b6f6141e4f0458be8d64a243ce`,
      provenance: "onchain:bsc-testnet",
    },
    registerJob: {
      hash: "0x843a8e9de35389942f04226c1b8322a0dc05ce3698aafea0fd8b2f13ad578f3f",
      status: "success",
      blockNumber: "124866829",
      timestamp: "2026-08-13T15:54:06.000Z",
      explorerUrl: `${EXPLORER}/0x843a8e9de35389942f04226c1b8322a0dc05ce3698aafea0fd8b2f13ad578f3f`,
      provenance: "onchain:bsc-testnet",
    },
    setBudget: {
      hash: "0x1414750595ef9bc36f9b83c85f7345f9da74af4ad2b0a114152d94c1d7b62232",
      status: "success",
      blockNumber: "124866907",
      timestamp: "2026-08-13T15:54:41.000Z",
      explorerUrl: `${EXPLORER}/0x1414750595ef9bc36f9b83c85f7345f9da74af4ad2b0a114152d94c1d7b62232`,
      provenance: "onchain:bsc-testnet",
    },
    approve: {
      hash: "0x11bf5cd1de0a0a97547d39955c32eb4d890af2b38beb8dfaee5de21c71308885",
      status: "success",
      blockNumber: "124866912",
      timestamp: "2026-08-13T15:54:43.000Z",
      explorerUrl: `${EXPLORER}/0x11bf5cd1de0a0a97547d39955c32eb4d890af2b38beb8dfaee5de21c71308885`,
      provenance: "onchain:bsc-testnet",
    },
    fund: {
      hash: "0x7a3e76c1f11449264e89b7589e72d6c5acae804fba7142d26a6009edfa5ee227",
      status: "success",
      blockNumber: "124866923",
      timestamp: "2026-08-13T15:54:48.000Z",
      explorerUrl: `${EXPLORER}/0x7a3e76c1f11449264e89b7589e72d6c5acae804fba7142d26a6009edfa5ee227`,
      provenance: "onchain:bsc-testnet",
    },
    submit: {
      hash: "0xe64f43b0a4daa7a60e2d0708d5851765be206da55563d601fa3c2dd2e5451a32",
      status: "success",
      blockNumber: "124867080",
      timestamp: "2026-08-13T15:55:59.000Z",
      explorerUrl: `${EXPLORER}/0xe64f43b0a4daa7a60e2d0708d5851765be206da55563d601fa3c2dd2e5451a32`,
      provenance: "onchain:bsc-testnet",
    },
  },
  fixture: {
    testInfrastructure: true,
    marketplaceAgent: false,
    officialReferenceAgent: false,
  },
} as const satisfies PublicJobProofSnapshotRecord;
