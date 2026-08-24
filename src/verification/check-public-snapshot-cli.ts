import { PUBLIC_VERIFICATION_SNAPSHOT } from "../data/verification/public-verification-snapshot.js";

if (Date.now() > Date.parse(PUBLIC_VERIFICATION_SNAPSHOT.staleAfter)) {
  process.stderr.write(`Public verification snapshot expired at ${PUBLIC_VERIFICATION_SNAPSHOT.staleAfter}. Run npm run publish:verification before deploying.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public verification snapshot is valid until ${PUBLIC_VERIFICATION_SNAPSHOT.staleAfter}.\n`);
}
