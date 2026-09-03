import type { Erc8183JobFacts } from "./erc8183-browser-spike.ts";
import type { PublicJobProof } from "./public-job-proof.ts";
import type { VerifiedHireEvent } from "./verified-hire-event.ts";

export interface Erc8183TestnetJobTracking {
  liveStatus: "verified" | "unavailable";
  job: Erc8183JobFacts | null;
  snapshot: PublicJobProof["snapshot"] | null;
  // Hire phases of this job the observation Worker verified on chain 97.
  // Empty when the feed is unavailable; the page renders as before.
  verifiedPhases: VerifiedHireEvent[];
}
