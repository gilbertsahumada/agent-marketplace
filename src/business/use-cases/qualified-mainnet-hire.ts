import type { Erc8183HirePlan, NormalizedErc8183Quote } from "../entities/erc8183-browser-spike.ts";
import { Erc8183SpikeDisabledError } from "../errors/erc8183-spike-errors.ts";
import type { PrepareErc8183Hire, PrepareErc8183HireInput } from "./prepare-erc8183-hire.ts";
import type { NotifyFundedJob } from "./notify-funded-job.ts";
import type { RequestErc8183Quote } from "./request-erc8183-quote.ts";
import type { GetMainnetHiringExposure } from "./get-mainnet-hiring-exposure.ts";
import type { GetErc8183JobStatus } from "./get-erc8183-job-status.ts";

async function requireCurrentQualification(exposure: GetMainnetHiringExposure): Promise<void> {
  if (!(await exposure.execute()).demoConfig) throw new Erc8183SpikeDisabledError();
}

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
    await requireCurrentQualification(this.exposure);
    if (!this.writesEnabled()) throw new Erc8183SpikeDisabledError();
    return this.notifyFunded.execute(input);
  }
}
