import { NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import type { Erc8183QuoteEnvelope } from "../../business/entities/erc8183-browser-spike.js";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183JobNotReadyError,
  Erc8183QuoteRejectedError,
  Erc8183SpikeDisabledError,
  Erc8183SpikeUnavailableError,
  InvalidErc8183SpikeInputError,
} from "../../business/errors/erc8183-spike-errors.js";
import { BoundedRequestJsonError, readBoundedRequestJson } from "./bounded-request-json.js";

const MAX_BODY_BYTES = 24 * 1_024;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidErc8183SpikeInputError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export async function spikeJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return record(await readBoundedRequestJson(request, MAX_BODY_BYTES), "body");
  } catch (error) {
    if (error instanceof InvalidErc8183SpikeInputError) throw error;
    if (error instanceof BoundedRequestJsonError) {
      throw new InvalidErc8183SpikeInputError(error.message);
    }
    throw new InvalidErc8183SpikeInputError("Request body must be valid JSON");
  }
}

export function spikeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string") {
    throw new InvalidErc8183SpikeInputError(`${field} must be an EVM address`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new InvalidErc8183SpikeInputError(`${field} must be an EVM address`);
  }
}

export function spikeJobId(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value === "0") {
    throw new InvalidErc8183SpikeInputError("jobId must be a positive integer");
  }
  return value;
}

export function spikeQuote(value: unknown): Erc8183QuoteEnvelope {
  return record(value, "quote");
}

export function erc8183SpikeErrorResponse(error: unknown, networkLabel = "Testnet"): NextResponse {
  if (error instanceof Erc8183SpikeDisabledError) {
    return NextResponse.json(
      { error: { code: error.name, message: `The experimental ${networkLabel} flow is disabled.` } },
      { status: 404 },
    );
  }
  if (error instanceof InvalidErc8183SpikeInputError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 400 });
  }
  if (error instanceof Erc8183DemoJobNotFoundError) {
    return NextResponse.json(
      { error: { code: error.name, message: `The ${networkLabel} demo job was not found.` } },
      { status: 404 },
    );
  }
  if (error instanceof Erc8183QuoteRejectedError || error instanceof Erc8183JobNotReadyError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 409 });
  }
  if (error instanceof Erc8183SpikeUnavailableError) {
    return NextResponse.json(
      { error: { code: error.name, message: `The ${networkLabel} seller or chain check is unavailable.` } },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: `The ${networkLabel} spike request could not be completed.` } },
    { status: 500 },
  );
}
