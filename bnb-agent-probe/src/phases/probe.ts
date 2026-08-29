import { BscProbeError } from "../lib/chain";
import { QuoteValidationError, type ProbeQuoteVerdict } from "../lib/quote";
import { SellerProbeError } from "../lib/seller-client";

export type ProbeTransport = "a2a" | "erc8183_http";
export type ProbeOutcome =
  | "quote_verified"
  | "protocol_valid"
  | "quote_rejected"
  | "quote_invalid"
  | "reachable"
  | "unreachable"
  | "unsafe_url"
  | "error";

export interface ProbeTarget {
  readonly agentId: string;
  readonly chainId: 56;
  readonly transport: ProbeTransport;
  readonly endpoint: string;
  readonly categoriesJson: string;
  readonly currentMetadataUpdatedAt: number | null;
  readonly lastSeenAt?: number;
  readonly priority?: number;
  readonly bootstrapSource?: "marketplace-inventory";
}

export type ProbeReconciliation =
  | { readonly status: "current"; readonly metadataUpdatedAt: number | null }
  | { readonly status: "metadata_unavailable" }
  | { readonly status: "removed" };

export interface ProbeObservation {
  readonly outcome: ProbeOutcome;
  readonly probeCategory: "grid_trading";
  readonly observedMetadataUpdatedAt: number | null;
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly observedWallet?: string;
  readonly observedWalletSource?: "agentWallet" | "ownerOf";
  readonly observedBlockNumber?: string;
  readonly onchainObservedAt?: number;
  readonly commerce?: string;
  readonly router?: string;
  readonly policy?: string;
  readonly providerSig?: undefined;
  readonly signer?: string;
  readonly signatureMethod?: "eip191" | "erc1271";
  readonly requestHash?: string;
  readonly negotiationHash?: string;
  readonly priceRaw?: string;
  readonly currency?: string;
  readonly decimals?: number;
  readonly quoteNegotiatedAt?: number;
  readonly quoteExpiresAt?: number;
}

export interface ProbePhaseSummary {
  readonly phase: "probe";
  readonly status: "ok";
  readonly processedTargets: 0 | 1;
  readonly outcome: ProbeOutcome | "no_candidate" | "metadata_unavailable" | "removed";
  readonly requests: number;
  readonly wallTimeMs: number;
}

export interface ProbePhaseInput {
  readonly agentAllowlist: readonly string[];
  readonly endpointAllowlist: readonly string[];
  readonly limit: number;
  readonly nowMs: number;
  readonly startedAtMs: number;
  readonly now: () => number;
  readonly requestCount?: () => number;
}

interface ChainContext {
  readonly provider: string;
  readonly walletSource?: "agentWallet" | "ownerOf";
  readonly blockNumber?: bigint;
  readonly blockTimestamp?: bigint;
  readonly commerce?: string;
  readonly router?: string;
  readonly policy?: string;
}

export interface ProbePhaseDependencies {
  readonly selectTarget: (input: {
    readonly agentAllowlist: readonly string[];
    readonly endpointAllowlist: readonly string[];
    readonly limit: number;
  }) => Promise<ProbeTarget | null>;
  readonly refreshTarget: (target: ProbeTarget) => Promise<ProbeReconciliation>;
  readonly readChainContext: (target: ProbeTarget) => Promise<ChainContext>;
  readonly probeSeller: (
    target: ProbeTarget,
    chain: ChainContext,
  ) => Promise<{ readonly quote: Record<string, unknown> }>;
  readonly validateQuote: (
    quote: Record<string, unknown>,
    chain: ChainContext,
  ) => Promise<ProbeQuoteVerdict>;
  readonly commit: (input: {
    readonly target: ProbeTarget | null;
    readonly reconciliation: ProbeReconciliation | null;
    readonly observation: ProbeObservation | null;
    readonly nextPriority: 0 | 1 | null;
    readonly summary: ProbePhaseSummary;
  }) => Promise<void>;
}

export async function runProbePhase(
  input: ProbePhaseInput,
  dependencies: ProbePhaseDependencies,
): Promise<ProbePhaseSummary> {
  if (input.limit !== 1) throw new Error("WP3_PROBE_LIMIT");
  const target = await dependencies.selectTarget({
    agentAllowlist: input.agentAllowlist,
    endpointAllowlist: input.endpointAllowlist,
    limit: input.limit,
  });
  if (!target) {
    const summary = phaseSummary(input, 0, "no_candidate");
    await dependencies.commit({
      target: null,
      reconciliation: null,
      observation: null,
      nextPriority: null,
      summary,
    });
    return summary;
  }
  assertAllowlisted(target, input);
  const reconciliation = await dependencies.refreshTarget(target);
  if (reconciliation.status !== "current") {
    const summary = phaseSummary(input, 1, reconciliation.status);
    await dependencies.commit({
      target,
      reconciliation,
      observation: null,
      nextPriority: 1,
      summary,
    });
    return summary;
  }

  const observedAt = input.now();
  let observation: ProbeObservation;
  try {
    const chain = await dependencies.readChainContext(target);
    const seller = await dependencies.probeSeller(target, chain);
    const verdict = await dependencies.validateQuote(seller.quote, chain);
    observation = verdictObservation(
      verdict,
      reconciliation.metadataUpdatedAt,
      chain,
      Math.max(0, input.now() - observedAt),
    );
  } catch (error) {
    const classified = classifyExpectedFailure(error);
    if (!classified) throw error;
    observation = {
      outcome: classified.outcome,
      probeCategory: "grid_trading",
      observedMetadataUpdatedAt: reconciliation.metadataUpdatedAt,
      errorCode: classified.errorCode,
      durationMs: Math.max(0, input.now() - observedAt),
    };
  }
  const summary = phaseSummary(input, 1, observation.outcome);
  await dependencies.commit({
    target,
    reconciliation,
    observation,
    nextPriority: 0,
    summary,
  });
  return summary;
}

function verdictObservation(
  verdict: ProbeQuoteVerdict,
  metadataUpdatedAt: number | null,
  chain: ChainContext,
  durationMs: number,
): ProbeObservation {
  const onchain = {
    observedWallet: chain.provider,
    ...(chain.walletSource ? { observedWalletSource: chain.walletSource } : {}),
    ...(chain.blockNumber === undefined ? {} : { observedBlockNumber: chain.blockNumber.toString() }),
    ...(chain.blockTimestamp === undefined
      ? {}
      : { onchainObservedAt: Number(chain.blockTimestamp) * 1_000 }),
    ...(chain.commerce ? { commerce: chain.commerce } : {}),
    ...(chain.router ? { router: chain.router } : {}),
    ...(chain.policy ? { policy: chain.policy } : {}),
  };
  if (verdict.outcome === "quote_rejected") {
    return {
      outcome: verdict.outcome,
      probeCategory: "grid_trading",
      observedMetadataUpdatedAt: metadataUpdatedAt,
      errorCode: verdict.errorCode,
      requestHash: verdict.requestHash,
      durationMs,
      ...onchain,
    };
  }
  return {
    outcome: verdict.outcome,
    probeCategory: "grid_trading",
    observedMetadataUpdatedAt: metadataUpdatedAt,
    errorCode: null,
    providerSig: undefined,
    signer: verdict.signer,
    signatureMethod: verdict.signatureMethod,
    requestHash: verdict.requestHash,
    negotiationHash: verdict.negotiationHash,
    priceRaw: verdict.priceRaw,
    currency: verdict.currency,
    decimals: verdict.decimals,
    quoteNegotiatedAt: verdict.quoteNegotiatedAt,
    quoteExpiresAt: verdict.quoteExpiresAt,
    durationMs,
    ...onchain,
  };
}

function classifyExpectedFailure(error: unknown): {
  outcome: ProbeOutcome;
  errorCode: string;
} | null {
  if (error instanceof QuoteValidationError) {
    return { outcome: "quote_invalid", errorCode: error.code };
  }
  if (error instanceof BscProbeError) {
    return { outcome: "error", errorCode: error.code };
  }
  if (error instanceof SellerProbeError) {
    if (error.code === "SELLER_UNSAFE_URL") {
      return { outcome: "unsafe_url", errorCode: error.code };
    }
    if (error.code === "SELLER_TIMEOUT" || error.code === "SELLER_UNREACHABLE") {
      return { outcome: "unreachable", errorCode: error.code };
    }
    return { outcome: "reachable", errorCode: error.code };
  }
  return null;
}

function assertAllowlisted(target: ProbeTarget, input: ProbePhaseInput): void {
  if (
    target.chainId !== 56
    || !input.agentAllowlist.includes(target.agentId)
    || !input.endpointAllowlist.includes(target.endpoint)
  ) throw new Error("WP3_TARGET_ALLOWLIST");
  const categories: unknown = JSON.parse(target.categoriesJson);
  if (!Array.isArray(categories) || categories.length !== 1 || categories[0] !== "grid_trading") {
    throw new Error("WP3_TARGET_CATEGORY");
  }
}

function phaseSummary(
  input: ProbePhaseInput,
  processedTargets: 0 | 1,
  outcome: ProbePhaseSummary["outcome"],
): ProbePhaseSummary {
  return {
    phase: "probe",
    status: "ok",
    processedTargets,
    outcome,
    requests: input.requestCount?.() ?? 0,
    wallTimeMs: Math.max(0, input.now() - input.startedAtMs),
  };
}
