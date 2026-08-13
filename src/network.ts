import { resolveNetwork, type NetworkConfig } from "@bnbagent/sdk";
import { getAddress } from "viem";

export const ACTIVE_TESTNET_POLICY = getAddress(
  "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
);

export const GATE1_NETWORK: NetworkConfig = Object.freeze({
  ...resolveNetwork("bsc-testnet"),
  policyContract: ACTIVE_TESTNET_POLICY,
});
