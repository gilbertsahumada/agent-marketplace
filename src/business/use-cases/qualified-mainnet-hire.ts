import type { Erc8183HirePlan, NormalizedErc8183Quote } from "../entities/erc8183-browser-spike.js";
import { Erc8183SpikeDisabledError } from "../errors/erc8183-spike-errors.js";
import type { PrepareErc8183Hire, PrepareErc8183HireInput } from "./prepare-erc8183-hire.js";
import type { NotifyFundedJob } from "./notify-funded-job.js";
import type { RequestErc8183Quote } from "./request-erc8183-quote.js";
import type { GetMainnetHiringExposure } from "./get-mainnet-hiring-exposure.js";
import type { GetErc8183JobStatus } from "./get-erc8183-job-status.js";

function requireCurrentQualification(exposure: GetMainnetHiringExposure): void {
  if (!exposure.execute().demoConfig) throw new Erc8183SpikeDisabledError();
}

export class RequestQualifiedMainnetQuote {
  constructor(
    private readonly exposure: GetMainnetHiringExposure,
    private readonly requestQuote: RequestErc8183Quote,
  ) {}

  execute(): Promise<NormalizedErc8183Quote> {
    requireCurrentQualification(this.exposure);
    return this.requestQuote.execute();
  }
}

export class PrepareQualifiedMainnetHire {
  constructor(
    private readonly exposure: GetMainnetHiringExposure,
    private readonly writesEnabled: () => boolean,
    private readonly prepareHire: PrepareErc8183Hire,
  ) {}

  execute(input: PrepareErc8183HireInput): Promise<Erc8183HirePlan> {
    requireCurrentQualification(this.exposure);
    if (!this.writesEnabled()) throw new Erc8183SpikeDisabledError();
    return this.prepareHire.execute(input);
  }
}

export class NotifyQualifiedMainnetFundedJob {
  constructor(
    private readonly exposure: GetMainnetHiringExposure,
    private readonly writesEnabled: () => boolean,
    private readonly getJobStatus: GetErc8183JobStatus,
    private readonly notifyFunded: NotifyFundedJob,
  ) {}

  async execute(input: Parameters<NotifyFundedJob["execute"]>[0]) {
    const job = await this.getJobStatus.execute({ jobId: input.jobId });
    if (job.status === "SUBMITTED" || job.status === "COMPLETED") {
      return this.notifyFunded.execute(input);
    }
    requireCurrentQualification(this.exposure);
    if (!this.writesEnabled()) throw new Erc8183SpikeDisabledError();
    return this.notifyFunded.execute(input);
  }
}
