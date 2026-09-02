import "server-only";

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

// Forwards one sanitized hire event to the Worker, which verifies chain phases
// by RPC before storing them. The browser never sees the destination or bearer;
// the payload carries no user, session or request context.
export async function syncHireEvent(
  input: HireEventSyncInput,
  options: { readonly env?: Environment; readonly fetchImpl?: typeof fetch } = {},
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
  try {
    const response = await (options.fetchImpl ?? fetch)(destination, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 201) return { status: "recorded" };
    if (response.status === 200) return { status: "duplicate" };
    if (response.status === 409) return { status: "rejected" };
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
