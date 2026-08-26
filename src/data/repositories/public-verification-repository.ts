import type { PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.ts";
import { PUBLIC_VERIFICATION_SNAPSHOT } from "../verification/public-verification-snapshot.ts";

export interface PublicVerificationRepository {
  getSnapshot(): PublicVerificationSnapshot;
}

export class StaticPublicVerificationRepository implements PublicVerificationRepository {
  getSnapshot(): PublicVerificationSnapshot {
    return structuredClone(PUBLIC_VERIFICATION_SNAPSHOT);
  }
}
