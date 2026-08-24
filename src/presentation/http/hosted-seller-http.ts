import { NextResponse } from "next/server";
import type { HostedSellerMessage } from "../../business/entities/hosted-erc8183-seller.js";
import {
  HostedSellerJobNotReadyError,
  HostedSellerUnavailableError,
  InvalidHostedSellerRequestError,
} from "../../business/errors/hosted-seller-errors.js";

const MAX_BODY_BYTES = 24_000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidHostedSellerRequestError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

export async function parseHostedSellerRequest(request: Request): Promise<{
  id: unknown;
  message: HostedSellerMessage;
}> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new InvalidHostedSellerRequestError("Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new InvalidHostedSellerRequestError("Request body is too large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InvalidHostedSellerRequestError("Request body must be valid JSON");
  }
  const rpc = record(raw, "JSON-RPC request");
  if (rpc.jsonrpc !== "2.0" || rpc.method !== "message/send") {
    throw new InvalidHostedSellerRequestError("Expected JSON-RPC message/send");
  }
  const params = record(rpc.params, "params");
  const envelope = record(params.message, "message");
  if (!Array.isArray(envelope.parts)) {
    throw new InvalidHostedSellerRequestError("message.parts must be an array");
  }
  const part = envelope.parts.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      (candidate as JsonRecord).kind === "data",
  );
  const data = record(record(part, "data part").data, "data");
  if (data.skill === "negotiate-erc8183-job") {
    if (
      typeof data.task_description !== "string" ||
      data.task_description.length === 0 ||
      data.task_description.length > 1_000
    ) {
      throw new InvalidHostedSellerRequestError("task_description is invalid");
    }
    return {
      id: rpc.id ?? null,
      message: {
        skill: "negotiate-erc8183-job",
        taskDescription: data.task_description,
        terms: record(data.terms, "terms"),
      },
    };
  }
  if (
    data.skill === "notify_funded" &&
    typeof data.job_id === "number" &&
    Number.isSafeInteger(data.job_id) &&
    data.job_id > 0
  ) {
    return {
      id: rpc.id ?? null,
      message: { skill: "notify_funded", jobId: data.job_id },
    };
  }
  throw new InvalidHostedSellerRequestError("Unknown or invalid seller skill");
}

export function hostedSellerRpcResult(id: unknown, data: JsonRecord) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result: {
      kind: "message",
      role: "agent",
      messageId: crypto.randomUUID(),
      parts: [{ kind: "data", data }],
    },
  });
}

export function hostedSellerErrorResponse(
  error: unknown,
  id: unknown = null,
  sellerLabel = "Testnet seller",
) {
  if (
    error instanceof InvalidHostedSellerRequestError ||
    error instanceof HostedSellerJobNotReadyError
  ) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: error.message },
      },
      { status: 400 },
    );
  }
  if (error instanceof HostedSellerUnavailableError) {
    return NextResponse.json(
      { error: { code: error.name, message: `The ${sellerLabel} is unavailable.` } },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The seller request failed." } },
    { status: 500 },
  );
}
