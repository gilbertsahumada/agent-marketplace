export class Erc8183SpikeDisabledError extends Error {
  constructor() {
    super("The browser-wallet spike is disabled");
    this.name = "ERC8183_SPIKE_DISABLED";
  }
}

export class InvalidErc8183SpikeInputError extends Error {
  constructor(message = "The browser-wallet spike request is invalid") {
    super(message);
    this.name = "INVALID_ERC8183_SPIKE_INPUT";
  }
}

export class Erc8183QuoteRejectedError extends Error {
  constructor(message = "The seller quote did not pass the spike policy") {
    super(message);
    this.name = "ERC8183_QUOTE_REJECTED";
  }
}

export class Erc8183JobNotReadyError extends Error {
  constructor(message = "The ERC-8183 job is not ready for this operation") {
    super(message);
    this.name = "ERC8183_JOB_NOT_READY";
  }
}

export class Erc8183DemoJobNotFoundError extends Error {
  constructor() {
    super("The job is not part of the fixed Testnet demo");
    this.name = "ERC8183_DEMO_JOB_NOT_FOUND";
  }
}

export class Erc8183SpikeUnavailableError extends Error {
  constructor(message = "The browser-wallet spike dependency is unavailable") {
    super(message);
    this.name = "ERC8183_SPIKE_UNAVAILABLE";
  }
}
