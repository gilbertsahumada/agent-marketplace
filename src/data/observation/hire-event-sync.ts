import "server-only";

import { MarketplaceRateLimitError } from "../../business/errors/marketplace-errors.ts";
import { callerFingerprint } from "./caller-fingerprint.ts";
import { privateWorkerUrl } from "./catalog-observation-sync.ts";

export const HIRE_EVENT_PHASES = ["clicked", "created", "funded", "submitted"] as const;
export type HireEventPhase = (typeof HIRE_EVENT_PHASES)[number];
export type HireEventSyncStatus = "recorded" | "duplicate" | "rejected" | "failed" | "not_configured";

export interface HireEventSyncInput {
  readonly agentId: string;
  readonly chainId: 56 | 97;
  readonly phase: HireEventPhase;
  readonly jobId: string | null;
  readonly txHash: string | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

function retryAfterSeconds(response: Response, payload: unknown): number {
  const header = Number(response.headers.get("retry-after"));
  const fromPayload = (payload as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  const seconds = Number.isFinite(header) && header > 0
    ? header
    : typeof fromPayload === "number" && Number.isFinite(fromPayload) ? fromPayload / 1_000 : 60;
  return Math.min(86_400, Math.max(1, Math.ceil(seconds)));
}

// Forwards one sanitized hire event to the Worker, which verifies chain phases
// by RPC before storing them. The browser never sees the destination or bearer;
// the payload carries no user, session or request context — the Worker only
// receives an HMAC fingerprint of it for its per-caller telemetry budget.
export async function syncHireEvent(
  input: HireEventSyncInput,
  options: { readonly env?: Environment; readonly fetchImpl?: typeof fetch; readonly caller?: string } = {},
): Promise<{ status: HireEventSyncStatus }> {
  const env = options.env ?? process.env;
  const destination = privateWorkerUrl(env, "/hire-events");
  const secret = env.BUYER_OBSERVATION_SECRET?.trim();
  if (!destination || !secret) return { status: "not_configured" };
  const body = JSON.stringify({
    schemaVersion: 2,
    agentId: input.agentId,
    chainId: input.chainId,
    phase: input.phase,
    jobId: input.jobId,
    txHash: input.txHash,
  });
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-marketplace-caller": callerFingerprint("hire-event-caller", options.caller, secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: "failed" };
  }
  if (response.status === 201) return { status: "recorded" };
  if (response.status === 200) return { status: "duplicate" };
  if (response.status === 409) return { status: "rejected" };
  if (response.status === 429) {
    const payload = await response.json().catch(() => null);
    throw new MarketplaceRateLimitError(
      retryAfterSeconds(response, payload),
      "Hire event reporting is temporarily at capacity",
    );
  }
  return { status: "failed" };
}
