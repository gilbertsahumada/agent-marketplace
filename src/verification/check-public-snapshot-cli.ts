import { assertPublicVerificationSnapshotFresh, PUBLIC_VERIFICATION_SNAPSHOT } from "../data/verification/public-verification-snapshot.ts";

try {
  assertPublicVerificationSnapshotFresh(PUBLIC_VERIFICATION_SNAPSHOT);
  process.stdout.write(`Public verification snapshot is valid until ${PUBLIC_VERIFICATION_SNAPSHOT.staleAfter}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Public verification snapshot is stale."}\n`);
  process.exitCode = 1;
}
