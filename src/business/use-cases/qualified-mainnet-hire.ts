import type { Erc8183HirePlan, NormalizedErc8183Quote } from "../entities/erc8183-browser-spike.js";
import { Erc8183SpikeDisabledError } from "../errors/erc8183-spike-errors.js";
import type { PrepareErc8183Hire, PrepareErc8183HireInput } from "./prepare-erc8183-hire.js";
import type { RequestErc8183Quote } from "./request-erc8183-quote.js";
import type { GetMainnetHiringExposure } from "./get-mainnet-hiring-exposure.js";

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
    private readonly prepareHire: PrepareErc8183Hire,
  ) {}

  execute(input: PrepareErc8183HireInput): Promise<Erc8183HirePlan> {
    requireCurrentQualification(this.exposure);
    return this.prepareHire.execute(input);
  }
}
