export class InvalidPublicJobProofIdError extends Error {
  readonly code = "INVALID_PUBLIC_JOB_PROOF_ID";

  constructor() {
    super("jobId must be a positive numeric identifier");
    this.name = "InvalidPublicJobProofIdError";
  }
}

export class PublicJobProofNotFoundError extends Error {
  readonly code = "PUBLIC_JOB_PROOF_NOT_FOUND";

  constructor(readonly jobId: string) {
    super(`Public job proof not found for job ${jobId}`);
    this.name = "PublicJobProofNotFoundError";
  }
}
