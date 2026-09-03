import type { Erc8183HirePlan, NormalizedErc8183Quote } from "../entities/erc8183-browser-spike.ts";
import { Erc8183SpikeDisabledError } from "../errors/erc8183-spike-errors.ts";
import type { PrepareErc8183Hire, PrepareErc8183HireInput } from "./prepare-erc8183-hire.ts";
import type { NotifyFundedJob } from "./notify-funded-job.ts";
import type { RequestErc8183Quote } from "./request-erc8183-quote.ts";
import type { MainnetHiringConfigReader } from "./get-mainnet-hiring-exposure.ts";
import type { GetErc8183JobStatus } from "./get-erc8183-job-status.ts";

export class RequestQualifiedMainnetQuote {
  constructor(private readonly requestQuote: RequestErc8183Quote) {}

  async execute(): Promise<NormalizedErc8183Quote> {
    return this.requestQuote.execute();
  }
}

export class PrepareQualifiedMainnetHire {
  constructor(
    private readonly writesEnabled: () => boolean,
    private readonly prepareHire: PrepareErc8183Hire,
  ) {}

  async execute(input: PrepareErc8183HireInput): Promise<Erc8183HirePlan> {
    if (!this.writesEnabled()) throw new Erc8183SpikeDisabledError();
    return this.prepareHire.execute(input);
  }
}

// Once the buyer has funded on chain, the money is in escrow and the only
// honest answer is to notify the seller. Worker observations authorize
// nothing here (DECISIONS 2026-08-29): the gates are the write flag, a seller
// that is still configured, and the on-chain checks NotifyFundedJob performs
// (buyer, seller, allowlist, FUNDED). A 60-second observation window cannot
// survive five wallet confirmations and stranded funded jobs.
export class NotifyQualifiedMainnetFundedJob {
  constructor(
    private readonly configs: MainnetHiringConfigReader,
    private readonly writesEnabled: () => boolean,
    private readonly getJobStatus: GetErc8183JobStatus,
    private readonly notifyFunded: NotifyFundedJob,
  ) {}

  async execute(input: Parameters<NotifyFundedJob["execute"]>[0]) {
    const job = await this.getJobStatus.execute({ jobId: input.jobId });
    if (job.status === "SUBMITTED" || job.status === "COMPLETED") {
      return this.notifyFunded.execute(input);
    }
    if (!this.writesEnabled()) throw new Erc8183SpikeDisabledError();
    this.configs.getPublicConfig();
    return this.notifyFunded.execute(input);
  }
}
