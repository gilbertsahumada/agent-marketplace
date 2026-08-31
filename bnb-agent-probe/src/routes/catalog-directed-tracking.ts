import { and, eq, or } from "drizzle-orm";
import { keccak256, stringToHex, type PublicClient } from "viem";

import type { D1DatabaseLike } from "../db/client";
import { createDatabase } from "../db/orm";
import {
  catalogAgents,
  catalogDirectedTracking,
  catalogIngestTasks,
  catalogObservations,
} from "../db/schema";
import { BSC_REGISTRY, createCountedBscClient } from "../lib/chain";
import type { D1Database } from "../types";

const AGENT_ID = /^[1-9]\d*$/;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const TRANSFER_TOPIC = keccak256(stringToHex("Transfer(address,address,uint256)"));
const ZERO_TOPIC = `0x${"0".repeat(64)}`;

interface DirectedInput {
  schemaVersion: 2;
  chainId: 56;
  agentId: string;
  txHash: `0x${string}`;
}

interface RegistrationProof {
  blockNumber: bigint;
}

export interface DirectedTrackingDependencies {
  nowMs: number;
  rpcUrl?: string;
  fetch?: typeof fetch;
  timeoutMs: number;
  verifyRegistration?: (input: DirectedInput) => Promise<RegistrationProof>;
}

async function parseInput(request: Request): Promise<DirectedInput> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_048) throw new Error("PAYLOAD_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("INVALID_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUEST");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "agentId,chainId,schemaVersion,txHash"
    || record.schemaVersion !== 2 || record.chainId !== 56
    || typeof record.agentId !== "string" || !AGENT_ID.test(record.agentId)
    || typeof record.txHash !== "string" || !TX_HASH.test(record.txHash)) throw new Error("INVALID_REQUEST");
  return { schemaVersion: 2, chainId: 56, agentId: record.agentId, txHash: record.txHash as `0x${string}` };
}

async function defaultVerify(input: DirectedInput, dependencies: DirectedTrackingDependencies): Promise<RegistrationProof> {
  if (!dependencies.rpcUrl) throw new Error("BSC_RPC_UNAVAILABLE");
  const startedAt = Date.now();
  const client = createCountedBscClient({
    rpcUrl: dependencies.rpcUrl,
    fetch: dependencies.fetch ?? fetch,
    deadlineMs: startedAt + dependencies.timeoutMs,
    now: Date.now,
  }) as PublicClient;
  let receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: input.txHash });
  } catch {
    throw new Error("REGISTRATION_TX_NOT_FOUND");
  }
  const tokenId = BigInt(input.agentId);
  const matched = receipt.status === "success" && receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== BSC_REGISTRY.toLowerCase() || log.topics[0] !== TRANSFER_TOPIC
      || log.topics.length < 4 || log.topics[1] !== ZERO_TOPIC || !log.topics[3]) return false;
    try { return BigInt(log.topics[3]) === tokenId; } catch { return false; }
  });
  if (!matched) throw new Error("REGISTRATION_TX_MISMATCH");
  return { blockNumber: receipt.blockNumber };
}

function errorResponse(code: string, status = 400): Response {
  return Response.json({ error: code }, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export async function createCatalogDirectedTrackingResponse(
  request: Request,
  binding: D1Database,
  dependencies: DirectedTrackingDependencies,
): Promise<Response> {
  let input: DirectedInput;
  try { input = await parseInput(request); } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "INVALID_REQUEST",
      error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400);
  }
  const db = createDatabase(binding as unknown as D1DatabaseLike);
  const agentKey = `eip155:56:${input.agentId}`;
  const existing = await db.select().from(catalogDirectedTracking).where(or(
    eq(catalogDirectedTracking.agentKey, agentKey),
    eq(catalogDirectedTracking.txHash, input.txHash.toLowerCase()),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].agentKey !== agentKey || existing[0].txHash !== input.txHash.toLowerCase()) {
      return errorResponse("REGISTRATION_TRACKING_CONFLICT", 409);
    }
    return Response.json({ schemaVersion: 2, status: existing[0].status, tracking: existing[0] }, {
      status: 200, headers: { "cache-control": "no-store" },
    });
  }
  let proof: RegistrationProof;
  try {
    proof = dependencies.verifyRegistration
      ? await dependencies.verifyRegistration(input)
      : await defaultVerify(input, dependencies);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
      ? error.message : "REGISTRATION_VERIFICATION_FAILED";
    return errorResponse(code, code === "REGISTRATION_TX_NOT_FOUND" ? 404 : 422);
  }
  const txHash = input.txHash.toLowerCase();
  const placeholderVersion = `directed:${txHash}`;
  const now = dependencies.nowMs;
  await db.batch([
    db.insert(catalogDirectedTracking).values({
      agentKey, chainId: 56, agentId: input.agentId, txHash,
      blockNumber: proof.blockNumber.toString(), status: "registered",
      registeredAt: now, listedAt: null, createdAt: now, updatedAt: now, errorCode: null,
    }),
    db.insert(catalogAgents).values({
      agentKey, agentId: input.agentId, chainId: 56, name: null, description: null, imageUrl: null,
      owner: null, metadataUri: null,
      categoriesJson: "[]", marketplaceConfigured: 0, metadataState: "other", indexState: "current",
      registeredAt: now, blockNumber: proof.blockNumber.toString(), firstSeenAt: now, lastSeenAt: now,
      priority: 100, metadataVersion: placeholderVersion, metadataObservedAt: null, policyVersion: 2,
    }).onConflictDoUpdate({
      target: catalogAgents.agentKey,
      set: { indexState: "current", blockNumber: proof.blockNumber.toString(), lastSeenAt: now, priority: 100 },
    }),
    db.insert(catalogObservations).values({
      attemptId: `registration:${txHash}`, agentKey, endpointKey: null, protocol: "erc8183",
      source: "chain_read", outcome: "erc8183_detected", observedAt: now, expiresAt: null,
      httpStatus: null, errorCode: null, durationMs: 0,
      detailsJson: JSON.stringify({ schemaVersion: 2, chainId: 56, txHash, blockNumber: proof.blockNumber.toString() }),
      validationKind: "chain", verificationLevel: "onchain", artifactHash: txHash,
    }).onConflictDoNothing(),
    db.insert(catalogIngestTasks).values({
      agentKey, metadataVersion: placeholderVersion, nextDeclarationIndex: 0, declarationCount: 0,
      status: "pending", requestedBy: "directed", priority: 100, generationStartedAt: now,
      upstreamObservedAt: null, updatedAt: now, attemptCount: 0, retryAt: 0,
      errorCode: null, leaseOwner: null, leaseExpiresAt: null,
    }).onConflictDoNothing(),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return Response.json({
    schemaVersion: 2,
    status: "registered",
    tracking: { chainId: 56, agentId: input.agentId, txHash, blockNumber: proof.blockNumber.toString() },
  }, { status: 201, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function catalogDirectedTrackingStatusResponse(request: Request, binding: D1Database): Promise<Response> {
  const match = /^\/catalog-directed-tracking\/([1-9]\d*)$/.exec(new URL(request.url).pathname);
  if (!match || new URL(request.url).search !== "") return errorResponse("INVALID_REQUEST");
  const db = createDatabase(binding as unknown as D1DatabaseLike);
  const agentKey = `eip155:56:${match[1]}`;
  const rows = await db.select({
    tracking: catalogDirectedTracking,
    taskStatus: catalogIngestTasks.status,
    nextDeclarationIndex: catalogIngestTasks.nextDeclarationIndex,
    declarationCount: catalogIngestTasks.declarationCount,
    retryAt: catalogIngestTasks.retryAt,
    ingestErrorCode: catalogIngestTasks.errorCode,
  }).from(catalogDirectedTracking)
    .leftJoin(catalogIngestTasks, eq(catalogIngestTasks.agentKey, catalogDirectedTracking.agentKey))
    .where(and(eq(catalogDirectedTracking.agentKey, agentKey), eq(catalogDirectedTracking.chainId, 56))).limit(1);
  if (!rows[0]) return errorResponse("NOT_FOUND", 404);
  return Response.json({ schemaVersion: 2, ...rows[0] }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
