export class InvalidHostedSellerRequestError extends Error {
  constructor(message = "The hosted seller request is invalid") {
    super(message);
    this.name = "INVALID_HOSTED_SELLER_REQUEST";
  }
}

export class HostedSellerJobNotReadyError extends Error {
  constructor(message = "The hosted seller job is not ready") {
    super(message);
    this.name = "HOSTED_SELLER_JOB_NOT_READY";
  }
}

export class HostedSellerUnavailableError extends Error {
  constructor(message = "The hosted seller is unavailable") {
    super(message);
    this.name = "HOSTED_SELLER_UNAVAILABLE";
  }
}
