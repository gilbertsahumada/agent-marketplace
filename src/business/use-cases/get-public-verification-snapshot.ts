import type { PublicVerificationSnapshot } from "../entities/public-verification-snapshot.js";

export interface PublicVerificationSnapshotReader {
  getSnapshot(): PublicVerificationSnapshot;
}

export class GetPublicVerificationSnapshot {
  constructor(private readonly reader: PublicVerificationSnapshotReader) {}
  execute(): PublicVerificationSnapshot { return this.reader.getSnapshot(); }
}
