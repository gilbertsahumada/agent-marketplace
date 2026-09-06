import type { ConciergeBrief } from "@/src/business/entities/concierge";

export const CONCIERGE_HANDOFF_TTL_MS = 30 * 60_000;

export interface ConciergeHandoff {
  schemaVersion: 1;
  agentId: string;
  contractHash: string;
  parameters: Record<string, unknown>;
  brief: ConciergeBrief | null;
  savedAt: number;
}

export function handoffKey(agentId: string): string {
  return `concierge:${agentId}`;
}

export function saveConciergeHandoff(
  storage: Storage | null,
  value: Omit<ConciergeHandoff, "schemaVersion" | "savedAt">,
  now: () => number = Date.now
): void {
  if (!storage) return;

  try {
    const handoff: ConciergeHandoff = {
      schemaVersion: 1,
      ...value,
      savedAt: now(),
    };
    storage.setItem(handoffKey(value.agentId), JSON.stringify(handoff));
  } catch {
    // Storage may throw (quota exceeded, access denied). Silently ignore.
  }
}

export function takeConciergeHandoff(
  storage: Storage | null,
  agentId: string,
  now: () => number = Date.now
): ConciergeHandoff | null {
  if (!storage) return null;

  const key = handoffKey(agentId);
  let value: unknown;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    value = JSON.parse(raw);
  } catch {
    // Malformed JSON or storage access failed. Remove and return null.
    try {
      storage.removeItem(key);
    } catch {
      // Ignore removal failure.
    }
    return null;
  }

  // Always remove the key, even if validation fails.
  try {
    storage.removeItem(key);
  } catch {
    // Ignore removal failure.
  }

  // Validate shape strictly.
  if (!isPlainObject(value)) return null;

  const { schemaVersion, agentId: storedAgentId, contractHash, parameters, brief, savedAt } = value as Record<string, unknown>;

  // schemaVersion must be 1.
  if (schemaVersion !== 1) return null;

  // agentId must match the argument.
  if (storedAgentId !== agentId) return null;

  // contractHash must be a 64-hex string.
  if (typeof contractHash !== "string" || !/^[0-9a-f]{64}$/i.test(contractHash)) return null;

  // parameters must be a plain object.
  if (!isPlainObject(parameters)) return null;

  // brief must be null or a valid ConciergeBrief.
  if (brief !== null && !isValidConciergeBrief(brief)) return null;

  // savedAt must be a number and within TTL.
  if (typeof savedAt !== "number" || savedAt + CONCIERGE_HANDOFF_TTL_MS <= now()) return null;

  return {
    schemaVersion: 1,
    agentId: storedAgentId as string,
    contractHash: contractHash as string,
    parameters: parameters as Record<string, unknown>,
    brief: brief as ConciergeBrief | null,
    savedAt: savedAt as number,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidConciergeBrief(value: unknown): value is ConciergeBrief {
  if (!isPlainObject(value)) return false;

  const { objective, deliverable, acceptanceCriteria } = value;

  if (typeof objective !== "string" || typeof deliverable !== "string" || typeof acceptanceCriteria !== "string") {
    return false;
  }

  for (const entry of [objective, deliverable, acceptanceCriteria]) {
    if (entry.trim().length < 1 || entry.length > 500) {
      return false;
    }
  }

  return true;
}
