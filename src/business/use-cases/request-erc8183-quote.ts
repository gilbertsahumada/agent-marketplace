import { assertAllowedQuote } from "../policies/erc8183-spike-policy.ts";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.ts";

export class RequestErc8183Quote {
  constructor(
    private readonly repository: Erc8183SpikeRepository,
    private readonly now: () => number = () => Math.floor(Date.now() / 1_000),
  ) {}

  async execute() {
    const quote = await this.repository.requestQuote();
    assertAllowedQuote(quote, this.repository.allowlist, this.now());
    return quote;
  }
}
