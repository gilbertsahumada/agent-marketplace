import type { Erc8183JobFacts } from "./erc8183-browser-spike.ts";
import type { PublicJobProof } from "./public-job-proof.ts";
import type { VerifiedHireEvent } from "./verified-hire-event.ts";

// What the marketplace can honestly say about the buyer address of a job.
// `demo_agent`: the address is the declared demo agent-buyer wallet; when
// that wallet has an ERC-8004 registry entry, `verified` records whether the
// registry wallet (or owner) read from chain equals the buyer. `unknown`:
// nothing is claimed — human-initiated jobs render exactly as before.
export interface BuyerIdentity {
  kind: "demo_agent" | "unknown";
  agentId: string | null;
  verified: boolean;
  registry: `0x${string}` | null;
}

export interface Erc8183TestnetJobTracking {
  liveStatus: "verified" | "unavailable";
  job: Erc8183JobFacts | null;
  snapshot: PublicJobProof["snapshot"] | null;
  // Hire phases of this job the observation Worker verified on chain 97.
  // Empty when the feed is unavailable; the page renders as before.
  verifiedPhases: VerifiedHireEvent[];
  buyerIdentity: BuyerIdentity;
}
