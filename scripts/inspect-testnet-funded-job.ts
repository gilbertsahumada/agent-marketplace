// Read-only diagnostic: no signer, seller notification or transaction submission.
import { ERC8183Client, JobStatus, parseJobDescription } from "@bnbagent/sdk/erc8183";
import { resolveNetwork } from "@bnbagent/sdk";

const value = process.argv[2];
if (!value || !/^[1-9]\d*$/.test(value)) throw new Error("Usage: node --import tsx scripts/inspect-testnet-funded-job.ts JOB_ID");
const client = await ERC8183Client.create({ network: resolveNetwork("bsc-testnet") });
const chainId = await client.publicClient.getChainId();
if (chainId !== 97) throw new Error("Unexpected RPC network");
const [job, block] = await Promise.all([client.getJob(BigInt(value)), client.publicClient.getBlock()]);
const quote = parseJobDescription(job.description);
console.log(JSON.stringify({
  chainId, block: block.number, chainTime: block.timestamp,
  jobId: value, buyer: job.client, provider: job.provider, status: JobStatus[job.status],
  budgetRaw: job.budget, deadline: job.expiredAt,
  deadlinePassed: block.timestamp >= job.expiredAt,
  submittedAt: job.submittedAt, deliverable: job.deliverable,
  negotiatedAt: quote?.negotiatedAt, quoteExpiresAt: quote?.quoteExpiresAt,
  negotiationHash: quote?.negotiationHash,
}, (_, item) => typeof item === "bigint" ? item.toString() : item, 2));
