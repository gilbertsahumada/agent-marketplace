import type { MarketplaceCategory } from "../../trust8004/types.ts";

// A marketplace-operated seller is a pure function from a validated input to
// a deterministic JSON deliverable. Nothing is stored: the quote is signed
// over the task description, and the deliverable is recomputed from that same
// description whenever the chain or a buyer asks for it. Every planner keeps
// the Grid seller's stance: it computes, it never executes, it holds nothing.

export interface HostedSellerTerms {
  readonly deliverables: string;
  readonly qualityStandards: string;
}

export interface HostedSellerPlanner<Input, Output> {
  /** Upper-case task prefix ending in a colon, e.g. `REBALANCE_PLAN_V1:`. */
  readonly taskPrefix: string;
  readonly terms: HostedSellerTerms;
  /** A representative input used for readiness probes and examples. */
  readonly canonicalInput: Input;
  /** Flat JSON schema (string, integer, number, boolean properties only). */
  readonly inputSchema: Record<string, unknown>;
  /** Returns the normalized input or throws an Error with a plain message. */
  validate(input: Input): Input;
  /** Deterministic: the same validated input always yields the same output. */
  build(input: Input): Output;
  /** `${taskPrefix}${JSON.stringify(validate(input))}` */
  taskDescription(input: Input): string;
  /** Inverse of taskDescription; throws when the prefix or fields are wrong. */
  parseTaskDescription(value: string): Input;
}

export type HostedSellerSlug = "grid" | "rebalance" | "yield" | "loan-health";

export interface HostedSellerService {
  readonly slug: HostedSellerSlug;
  /** ERC-8004 agent name; lower-case, hyphenated. */
  readonly name: string;
  /** One or two sentences for the agent card and the registry metadata. */
  readonly description: string;
  readonly category: MarketplaceCategory;
  /** Path under the seller origin where the SVG portrait is served. */
  readonly imagePath: string;
  readonly skillName: string;
  readonly skillDescription: string;
  readonly fundedSkillName: string;
  readonly fundedSkillDescription: string;
  readonly tags: readonly string[];
  readonly planner: HostedSellerPlanner<unknown, unknown>;
}
