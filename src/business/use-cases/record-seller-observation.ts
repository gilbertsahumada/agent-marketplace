import type { MainnetDemoPublicConfig } from "../entities/mainnet-browser-demo.ts";
import type { NormalizedErc8183Quote } from "../entities/erc8183-browser-spike.ts";
import type { SellerObservation, SellerObservationStore } from "../entities/seller-observation.ts";

export interface SellerObservationConfigReader {
  execute(): MainnetDemoPublicConfig;
}

export interface SellerQuoteReader {
  execute(): Promise<NormalizedErc8183Quote>;
}

export interface SellerObservationResult {
  observed: 0 | 1;
  reason?: string;
  observedAt?: string;
  agentId?: string;
  quoteStatus?: string;
}

/** Records one marketplace probe without persisting a derived hireability flag. */
export class RecordSellerObservation {
  constructor(
    private readonly config: SellerObservationConfigReader,
    private readonly quoteReader: SellerQuoteReader,
    private readonly storeFactory: () => SellerObservationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(): Promise<SellerObservationResult> {
    const demo = this.config.execute();
    if (!demo) return { observed: 0, reason: "No Mainnet seller is configured." };

    const store = this.storeFactory();
    const observedAt = this.now();
    const observation: SellerObservation = {
      agentId: String(demo.agentId),
      observedAt,
      quoteStatus: "unavailable",
      transport: "a2a",
      endpoint: null,
      priceRaw: null,
      currency: null,
      signatureMethod: null,
      errorCode: null,
    };

    try {
      const quote = await this.quoteReader.execute();
      observation.quoteStatus = "verified";
      observation.endpoint = quote.endpoint;
      observation.priceRaw = quote.priceRaw;
      observation.currency = quote.token;
    } catch (error) {
      observation.errorCode = error instanceof Error ? error.name : "PROBE_FAILED";
    }

    await store.record(observation);
    return {
      observed: 1,
      observedAt,
      agentId: observation.agentId,
      quoteStatus: observation.quoteStatus,
    };
  }
}
