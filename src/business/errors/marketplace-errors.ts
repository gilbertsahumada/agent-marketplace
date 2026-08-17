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

export class MarketplaceDataUnavailableError extends Error {
  constructor(readonly operation: string, options?: ErrorOptions) {
    super(`Marketplace data is unavailable for ${operation}`, options);
    this.name = "MarketplaceDataUnavailableError";
  }
}
