import type { Erc8183JobFacts } from "./erc8183-browser-spike.ts";
import type { PublicJobProof } from "./public-job-proof.ts";

export interface Erc8183TestnetJobTracking {
  liveStatus: "verified" | "unavailable";
  job: Erc8183JobFacts | null;
  snapshot: PublicJobProof["snapshot"] | null;
}
