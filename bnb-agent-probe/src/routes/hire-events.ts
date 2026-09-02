import { eq } from "drizzle-orm";
import {
  decodeEventLog,
  getAddress,
  isAddressEqual,
  parseAbi,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import { hireEvents } from "../db/schema";
import {
  BSC_COMMERCE,
  BSC_REGISTRY,
  BSC_TESTNET_COMMERCE,
  BSC_TESTNET_REGISTRY,
  BscProbeError,
  createCountedBscClient,
} from "../lib/chain";
import type { D1Database } from "../types";

const MAX_BODY_BYTES = 8 * 1_024;
const AGENT_ID = /^[1-9]\d{0,19}$/;
const JOB_ID = /^(?:0|[1-9]\d{0,77})$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const HIRE_TELEMETRY_PHASES = ["clicked", "quoted", "quote_rejected"] as const;
export const HIRE_CHAIN_PHASES = ["created", "funded", "submitted", "settled", "refunded"] as const;
export type HireTelemetryPhase = (typeof HIRE_TELEMETRY_PHASES)[number];
export type HireChainPhase = (typeof HIRE_CHAIN_PHASES)[number];
export type HireChainId = 56 | 97;

// Commerce events that prove a phase happened in the reported transaction.
const PHASE_EVENTS: Record<HireChainPhase, readonly string[]> = {
  created: ["JobCreated"],
  funded: ["JobFunded"],
  submitted: ["JobSubmitted"],
  settled: ["JobCompleted"],
  refunded: ["JobRejected", "JobExpired"],
};

// IACP.JobStatus: OPEN 0, FUNDED 1, SUBMITTED 2, COMPLETED 3, REJECTED 4, EXPIRED 5.
// The current state must be compatible with having passed through the phase;
// it does not have to equal the phase, because the job may have moved on.
const PHASE_COMPATIBLE_STATUS: Record<HireChainPhase, readonly number[]> = {
  created: [0, 1, 2, 3, 4, 5],
  funded: [1, 2, 3, 4, 5],
  submitted: [2, 3, 4],
  settled: [3],
  refunded: [4, 5],
};

const DEPLOYMENTS: Record<HireChainId, {
  readonly chain: typeof bsc | typeof bscTestnet;
  readonly commerce: Address;
  readonly registry: Address;
}> = {
  56: { chain: bsc, commerce: BSC_COMMERCE, registry: BSC_REGISTRY },
  97: { chain: bscTestnet, commerce: BSC_TESTNET_COMMERCE, registry: BSC_TESTNET_REGISTRY },
};

export const commerceEventsAbi = parseAbi([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, address indexed provider, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event JobExpired(uint256 indexed jobId)",
]);
const commerceReadAbi = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
]);
const registryAbi = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export type HireChainReader = Pick<PublicClient, "getTransactionReceipt" | "getBlock" | "multicall">;

export interface HireEventDependencies {
  readonly createReader?: (chainId: HireChainId) => HireChainReader;
  readonly fetchImpl?: typeof fetch;
}

export class HireEventRejected extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HireEventRejected";
  }
}

class InvalidHireEventRequest extends Error {}

type HireEventInput =
  | { readonly kind: "telemetry"; readonly chainId: HireChainId; readonly agentId: string; readonly phase: HireTelemetryPhase }
  | {
    readonly kind: "chain";
    readonly chainId: HireChainId;
    readonly agentId: string;
    readonly phase: HireChainPhase;
    readonly jobId: string;
    readonly txHash: Hash;
  };

type MulticallRead = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function parseInput(request: Request): Promise<HireEventInput> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new InvalidHireEventRequest();
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new InvalidHireEventRequest();
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new InvalidHireEventRequest();
  let value: unknown;
  try { value = JSON.parse(body) as unknown; } catch { throw new InvalidHireEventRequest(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidHireEventRequest();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "agentId,chainId,jobId,phase,schemaVersion,txHash"
    || record.schemaVersion !== 2
    || (record.chainId !== 56 && record.chainId !== 97)
    || typeof record.agentId !== "string" || !AGENT_ID.test(record.agentId)
    || typeof record.phase !== "string") {
    throw new InvalidHireEventRequest();
  }
  const base = { chainId: record.chainId as HireChainId, agentId: record.agentId };
  if ((HIRE_TELEMETRY_PHASES as readonly string[]).includes(record.phase)) {
    if (record.jobId !== null || record.txHash !== null) throw new InvalidHireEventRequest();
    return { kind: "telemetry", ...base, phase: record.phase as HireTelemetryPhase };
  }
  if ((HIRE_CHAIN_PHASES as readonly string[]).includes(record.phase)) {
    if (typeof record.jobId !== "string" || !JOB_ID.test(record.jobId)
      || typeof record.txHash !== "string" || !TX_HASH.test(record.txHash)) {
      throw new InvalidHireEventRequest();
    }
    return {
      kind: "chain",
      ...base,
      phase: record.phase as HireChainPhase,
      jobId: record.jobId,
      txHash: record.txHash.toLowerCase() as Hash,
    };
  }
  throw new InvalidHireEventRequest();
}

function readAddress(read: MulticallRead | undefined): Address | null {
  if (!read || read.status !== "success" || typeof read.result !== "string") return null;
  try { return getAddress(read.result); } catch { return null; }
}

async function verifyChainPhase(
  reader: HireChainReader,
  deployment: (typeof DEPLOYMENTS)[HireChainId],
  input: Extract<HireEventInput, { kind: "chain" }>,
): Promise<{ blockNumber: bigint; blockTimestamp: bigint }> {
  let receipt: Awaited<ReturnType<HireChainReader["getTransactionReceipt"]>>;
  try {
    receipt = await reader.getTransactionReceipt({ hash: input.txHash });
  } catch (error) {
    if (error instanceof BscProbeError) throw error;
    throw new HireEventRejected("RECEIPT_NOT_FOUND");
  }
  if (receipt.status !== "success") throw new HireEventRejected("RECEIPT_REVERTED");
  if (!receipt.to || !isAddressEqual(receipt.to, deployment.commerce)) {
    throw new HireEventRejected("CONTRACT_MISMATCH");
  }
  const jobId = BigInt(input.jobId);
  const eventNames = PHASE_EVENTS[input.phase];
  const proven = receipt.logs.some((log) => {
    if (!isAddressEqual(log.address, deployment.commerce)) return false;
    try {
      const decoded = decodeEventLog({ abi: commerceEventsAbi, data: log.data, topics: log.topics });
      return eventNames.includes(decoded.eventName) && (decoded.args as { jobId?: bigint }).jobId === jobId;
    } catch {
      return false;
    }
  });
  if (!proven) throw new HireEventRejected("EVENT_MISSING");

  const agentId = BigInt(input.agentId);
  let reads: readonly MulticallRead[];
  try {
    reads = await reader.multicall({
      contracts: [
        { address: deployment.commerce, abi: commerceReadAbi, functionName: "getJob", args: [jobId] },
        { address: deployment.registry, abi: registryAbi, functionName: "getAgentWallet", args: [agentId] },
        { address: deployment.registry, abi: registryAbi, functionName: "ownerOf", args: [agentId] },
      ],
      allowFailure: true,
    }) as readonly MulticallRead[];
  } catch (error) {
    if (error instanceof BscProbeError) throw error;
    throw new BscProbeError("BSC_READS");
  }
  const [jobRead, walletRead, ownerRead] = reads;
  if (!jobRead || jobRead.status !== "success" || !jobRead.result || typeof jobRead.result !== "object") {
    throw new HireEventRejected("JOB_MISSING");
  }
  const job = jobRead.result as { id: bigint; client: Address; provider: Address; status: number };
  if (job.id !== jobId || isAddressEqual(job.client, ZERO_ADDRESS)) throw new HireEventRejected("JOB_MISSING");
  if (!PHASE_COMPATIBLE_STATUS[input.phase].includes(Number(job.status))) {
    throw new HireEventRejected("JOB_STATUS_INCOMPATIBLE");
  }
  const wallet = readAddress(walletRead);
  const provider = wallet && !isAddressEqual(wallet, ZERO_ADDRESS) ? wallet : readAddress(ownerRead);
  if (!provider || isAddressEqual(provider, ZERO_ADDRESS) || !isAddressEqual(provider, job.provider)) {
    throw new HireEventRejected("AGENT_MISMATCH");
  }

  let block: { timestamp: bigint };
  try {
    block = await reader.getBlock({ blockNumber: receipt.blockNumber });
  } catch (error) {
    if (error instanceof BscProbeError) throw error;
    throw new BscProbeError("BSC_BLOCK_RPC");
  }
  return { blockNumber: receipt.blockNumber, blockTimestamp: block.timestamp };
}

export async function hireEventsResponse(
  request: Request,
  d1: D1Database,
  options: {
    readonly rpcUrls: Partial<Record<HireChainId, string>>;
    readonly nowMs: number;
    readonly timeoutMs: number;
    readonly dependencies?: HireEventDependencies;
  },
): Promise<Response> {
  let input: HireEventInput;
  try { input = await parseInput(request); } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const db = createDatabase(d1 as unknown as D1DatabaseLike);

  if (input.kind === "telemetry") {
    const eventKey = crypto.randomUUID();
    await db.insert(hireEvents).values({
      eventKey,
      agentId: input.agentId,
      chainId: input.chainId,
      phase: input.phase,
      provenance: "marketplace_observed",
      jobId: null,
      txHash: null,
      blockNumber: null,
      occurredAt: options.nowMs,
      verifiedAt: null,
    });
    return jsonResponse({
      schemaVersion: 2,
      status: "recorded",
      eventKey,
      provenance: "marketplace_observed",
      occurredAt: options.nowMs,
    }, 201);
  }

  const eventKey = `${input.chainId}:${input.txHash}:${input.phase}`;
  const existing = await db.select({ id: hireEvents.id }).from(hireEvents)
    .where(eq(hireEvents.eventKey, eventKey)).limit(1);
  if (existing[0]) return jsonResponse({ schemaVersion: 2, status: "duplicate", eventKey }, 200);

  const deployment = DEPLOYMENTS[input.chainId];
  const dependencies = options.dependencies ?? {};
  let reader: HireChainReader | null = null;
  if (dependencies.createReader) reader = dependencies.createReader(input.chainId);
  else {
    const rpcUrl = options.rpcUrls[input.chainId];
    if (rpcUrl) {
      reader = createCountedBscClient({
        rpcUrl,
        fetch: dependencies.fetchImpl ?? fetch,
        deadlineMs: options.nowMs + options.timeoutMs,
        now: Date.now,
        chain: deployment.chain,
      });
    }
  }
  if (!reader) {
    return jsonResponse({
      error: "chain_unavailable",
      code: input.chainId === 56 ? "BSC_RPC_URL_REQUIRED" : "BSC_TESTNET_RPC_URL_REQUIRED",
    }, 503);
  }

  let proof: { blockNumber: bigint; blockTimestamp: bigint };
  try {
    proof = await verifyChainPhase(reader, deployment, input);
  } catch (error) {
    if (error instanceof HireEventRejected) return jsonResponse({ error: "phase_rejected", code: error.code }, 409);
    if (error instanceof BscProbeError) return jsonResponse({ error: "chain_unavailable", code: error.code }, 503);
    throw error;
  }
  const occurredAt = Number(proof.blockTimestamp) * 1_000;
  const inserted = await db.insert(hireEvents).values({
    eventKey,
    agentId: input.agentId,
    chainId: input.chainId,
    phase: input.phase,
    provenance: "chain_verified",
    jobId: input.jobId,
    txHash: input.txHash,
    blockNumber: proof.blockNumber.toString(),
    occurredAt,
    verifiedAt: options.nowMs,
  }).onConflictDoNothing().returning({ id: hireEvents.id });
  if (!inserted[0]) return jsonResponse({ schemaVersion: 2, status: "duplicate", eventKey }, 200);
  return jsonResponse({
    schemaVersion: 2,
    status: "recorded",
    eventKey,
    provenance: "chain_verified",
    occurredAt,
    blockNumber: proof.blockNumber.toString(),
  }, 201);
}
