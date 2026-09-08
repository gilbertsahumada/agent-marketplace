import "server-only";
import { hostedSellerService } from "../business/policies/hosted-seller-catalog.ts";
import { areMainnetWritesEnabled } from "./mainnet-write-gate.ts";
import {
  MainnetHostedSellerRepository,
  mainnetHostedSellerNetwork,
  sharedRuntimeLoader,
  type MainnetHostedSellerRuntime,
} from "./hosted-seller-repository.ts";

export type MainnetGridRuntime = MainnetHostedSellerRuntime;

export function mainnetGridNetwork() {
  return mainnetHostedSellerNetwork();
}

const GRID = hostedSellerService("grid");

// The Grid seller is the "grid" slug of the hosted seller repository; this
// subclass keeps its constructor shape for the CLIs and tests that predate it.
export class MainnetGridSellerRepository extends MainnetHostedSellerRepository {
  constructor(
    loadRuntime: () => Promise<MainnetGridRuntime> = sharedRuntimeLoader(GRID),
    writesEnabled: () => boolean = areMainnetWritesEnabled,
  ) {
    super(GRID, loadRuntime, writesEnabled);
  }
}
