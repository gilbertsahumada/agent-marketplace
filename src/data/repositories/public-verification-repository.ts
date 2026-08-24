import type { PublicVerificationSnapshot } from "../../business/entities/public-verification-snapshot.js";
import { PUBLIC_VERIFICATION_SNAPSHOT } from "../verification/public-verification-snapshot.js";

export interface PublicVerificationRepository {
  getSnapshot(): PublicVerificationSnapshot;
}

export class StaticPublicVerificationRepository implements PublicVerificationRepository {
  getSnapshot(): PublicVerificationSnapshot {
    return structuredClone(PUBLIC_VERIFICATION_SNAPSHOT);
  }
}
