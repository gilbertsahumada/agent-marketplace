export class InvalidMarketplaceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMarketplaceInputError";
  }
}

export class MarketplaceAgentNotFoundError extends Error {
  constructor(readonly agentId: string) {
    super(`Marketplace agent ${agentId} was not found`);
    this.name = "MarketplaceAgentNotFoundError";
  }
}

export class HireJobNotFoundError extends Error {
  constructor(readonly chainId: number, readonly jobId: string) {
    super(`Job ${jobId} on chain ${chainId} is not in the indexed ledger`);
    this.name = "HireJobNotFoundError";
  }
}

export class MarketplaceDataUnavailableError extends Error {
  constructor(readonly operation: string, options?: ErrorOptions) {
    super(`Marketplace data is unavailable for ${operation}`, options);
    this.name = "MarketplaceDataUnavailableError";
  }
}

export class MarketplaceRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number, message = "Agent validation is temporarily at capacity") {
    super(message);
    this.name = "MarketplaceRateLimitError";
  }
}

export class MarketplacePayloadTooLargeError extends Error {
  constructor() {
    super("Validation input is too large");
    this.name = "MarketplacePayloadTooLargeError";
  }
}
