// Dependency-free identity policy shared by the marketplace and its Worker.
export type IdentityChainId = 56 | 97;
export const IDENTITY_REGISTRIES = {
  56: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  97: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
} as const;
export const IDENTITY_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
export const IDENTITY_BATCH_LIMIT = 25;

export function identityAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    && !/^0x0{40}$/.test(value) ? value.toLowerCase() as `0x${string}` : null;
}

// Owner fallback is opt-in and never hides which kind of wallet was used.
export function providerIdentity(input: { agentWallet: unknown; owner?: unknown; allowOwnerFallback?: boolean }) {
  const wallet = identityAddress(input.agentWallet);
  if (wallet) return { wallet, source: "agentWallet" as const };
  const owner = input.allowOwnerFallback ? identityAddress(input.owner) : null;
  return owner ? { wallet: owner, source: "ownerOf" as const } : null;
}

export interface AgentReference {
  chainId: IdentityChainId;
  registryAddress: string;
  agentId: string;
  name: string | null;
  profileAvailable: boolean;
}
export interface IndexedAgentIdentity extends AgentReference {
  wallet: string;
  source: "agentWallet" | "ownerOf";
  blockNumber: string;
  observedAt: number;
}
export interface JobAgentEvidence {
  jobId: string;
  provider: string;
  registered: Array<{ agent: AgentReference; verifiedAt: number | null; txHash: string }>;
  candidates: IndexedAgentIdentity[];
  candidatesTruncated: boolean;
}
export interface JobIdentityBatch {
  chainId: IdentityChainId;
  coverage: "partial";
  jobs: JobAgentEvidence[];
}
