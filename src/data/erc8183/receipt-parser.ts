import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  type TransactionReceipt,
} from "viem";
import { Erc8183JobNotReadyError } from "../../business/errors/erc8183-spike-errors.js";
import { agenticCommerceBrowserAbi, ERC8183_TESTNET } from "./contracts.js";

export function assertSuccessfulReceipt(receipt: TransactionReceipt): void {
  if (receipt.status !== "success") {
    throw new Erc8183JobNotReadyError("The wallet transaction reverted");
  }
}

export function extractConfirmedJobId(receipt: TransactionReceipt): bigint {
  assertSuccessfulReceipt(receipt);
  for (const log of receipt.logs) {
    if (!isAddressEqual(getAddress(log.address), ERC8183_TESTNET.commerce)) continue;
    try {
      const decoded = decodeEventLog({
        abi: agenticCommerceBrowserAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "JobCreated" && "jobId" in decoded.args) {
        return decoded.args.jobId;
      }
    } catch {
      // A receipt may contain unrelated token/router events.
    }
  }
  throw new Erc8183JobNotReadyError("Confirmed createJob receipt has no Commerce JobCreated event");
}
