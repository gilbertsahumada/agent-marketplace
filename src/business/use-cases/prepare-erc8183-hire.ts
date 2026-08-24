import { getAddress, type Address } from "viem";
import type {
  Erc8183HirePlan,
  Erc8183QuoteEnvelope,
  Erc8183TransactionIntent,
} from "../entities/erc8183-browser-spike.js";
import { Erc8183JobNotReadyError } from "../errors/erc8183-spike-errors.js";
import { assertAllowedQuote } from "../policies/erc8183-spike-policy.js";
import type { Erc8183SpikeRepository } from "../../data/repositories/erc8183-spike-repository.js";

export interface PrepareErc8183HireInput {
  buyer: Address;
  quote: Erc8183QuoteEnvelope;
}

export class PrepareErc8183Hire {
  constructor(
    private readonly repository: Erc8183SpikeRepository,
    private readonly now: () => number = () => Math.floor(Date.now() / 1_000),
  ) {}

  async execute(input: PrepareErc8183HireInput): Promise<Erc8183HirePlan> {
    const buyer = getAddress(input.buyer);
    const quote = await this.repository.validateQuote(input.quote);
    const now = this.now();
    assertAllowedQuote(quote, this.repository.allowlist, now);
    const facts = await this.repository.getBuyerFacts(buyer);
    if (!facts.policyAllowlisted) {
      throw new Erc8183JobNotReadyError("The configured policy is not allowlisted by the Router");
    }
    const budget = BigInt(quote.priceRaw);
    if (BigInt(facts.tokenBalanceRaw) < budget) {
      throw new Erc8183JobNotReadyError(`Buyer has insufficient ${this.repository.allowlist.networkLabel} payment-token balance`);
    }
    if (BigInt(facts.nativeBalanceRaw) <= 0n) {
      const gasSymbol = this.repository.allowlist.chainId === 97 ? "tBNB" : "BNB";
      throw new Erc8183JobNotReadyError(`Buyer needs ${gasSymbol} for ${this.repository.allowlist.networkLabel} browser-signed gas`);
    }
    const approvalRequired = BigInt(facts.allowanceRaw) < budget;
    const deadline = BigInt(now) + BigInt(facts.disputeWindowSeconds) + 3_600n;
    const transactions: Erc8183TransactionIntent[] = [
      { kind: "createJob", contract: quote.commerce, purpose: "Create the job and anchor the signed quote", required: true },
      { kind: "registerJob", contract: quote.router, purpose: "Bind the allowlisted optimistic policy", required: true },
      { kind: "setBudget", contract: quote.commerce, purpose: "Set the exact quoted budget", required: true },
      { kind: "approve", contract: quote.token, purpose: "Approve only the exact funding amount", required: approvalRequired },
      { kind: "fund", contract: quote.commerce, purpose: "Move the exact budget into ERC-8183 escrow", required: true },
    ];
    return {
      quote,
      buyer,
      seller: quote.provider,
      nativeBalanceRaw: facts.nativeBalanceRaw,
      tokenBalanceRaw: facts.tokenBalanceRaw,
      allowanceRaw: facts.allowanceRaw,
      approvalRequired,
      approvalAmountRaw: approvalRequired ? quote.priceRaw : "0",
      deadline: deadline.toString(),
      disputeWindowSeconds: facts.disputeWindowSeconds,
      executeBefore: quote.quoteExpiresAt,
      maximumSignatures: approvalRequired ? 5 : 4,
      transactions,
    };
  }
}
