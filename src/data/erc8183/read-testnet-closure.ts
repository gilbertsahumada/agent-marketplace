import "server-only";
import { createPublicClient, http, isAddressEqual, parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import { TESTNET_CLOSURE_PINS as pins } from "./testnet-closure-pins.ts";
import { implementationPinsMatch } from "../../mainnet/implementation-pins.ts";
import { closureState } from "../../mainnet/job-delivery.ts";

const abi = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))",
  "function jobPolicy(uint256 jobId) view returns (address)",
  "function disputeWindow() view returns (uint256)",
  "function disputed(uint256 jobId) view returns (bool)",
  "function check(uint256 jobId,bytes evidence) view returns (uint8,bytes32)",
]);
const statuses = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"];
export async function readTestnetClosure(jobId: string) {
  if (!/^[1-9]\d{0,19}$/.test(jobId)) throw new Error("Invalid job ID");
  const client = createPublicClient({ chain: bscTestnet, transport: http(pins.rpcUrl, { timeout: 10_000, retryCount: 0 }) });
  if (await client.getChainId() !== 97) throw new Error("Wrong network");
  const block = await client.getBlock();
  if (!await implementationPinsMatch(client, pins, block.number)) throw new Error("Changed contracts");
  const id = BigInt(jobId);
  const [job, policy, window, disputed, verdict] = await Promise.all([
    client.readContract({ address: pins.commerce, abi, functionName: "getJob", args: [id], blockNumber: block.number }),
    client.readContract({ address: pins.router, abi, functionName: "jobPolicy", args: [id], blockNumber: block.number }),
    client.readContract({ address: pins.policy, abi, functionName: "disputeWindow", blockNumber: block.number }),
    client.readContract({ address: pins.policy, abi, functionName: "disputed", args: [id], blockNumber: block.number }),
    client.readContract({ address: pins.policy, abi, functionName: "check", args: [id, "0x"], blockNumber: block.number }),
  ]);
  if (job.id !== id || !isAddressEqual(job.evaluator, pins.router) || !isAddressEqual(policy, pins.policy)) throw new Error("Unsupported job or policy");
  const status = statuses[job.status] ?? "UNKNOWN";
  return { jobId, chainId: 97 as const, buyer: job.client, status,
    closure: closureState(status, disputed, verdict[0], Number(job.submittedAt + window), Number(block.timestamp)),
    reviewEndsAt: String(job.submittedAt + window),
    settlementOutcome: verdict[0] === 1 ? "completed" as const : verdict[0] === 2 ? "rejected" as const : null,
    checkedBlock: String(block.number), checkedAt: new Date().toISOString() };
}
