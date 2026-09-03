import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read-only release smoke (docs/RELEASE.md). Issues GETs against the public
 * surfaces of one Worker origin and one marketplace origin, prints one line per
 * target and exits non-zero when any status, payload shape or the expected
 * kill-switch state disagrees. No POST, no bearer, no D1 access: it can run
 * against staging or production at any time without entering the evidence it
 * measures.
 */

const AGENT_ID = "303779";
const TESTNET_JOB_ID = "551";
const REQUEST_TIMEOUT_MS = 15_000;

export interface SmokeTarget {
  readonly label: string;
  readonly url: string;
  readonly check: (status: number, body: unknown) => string | null;
}

export interface SmokeResult {
  readonly label: string;
  readonly url: string;
  readonly status: number | null;
  readonly problem: string | null;
}

export interface SmokeOptions {
  readonly expectKillSwitch?: boolean;
}

function record(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

export function normalizeOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute https origin`);
  }
  const loopback = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an https origin without path, query or credentials`);
  }
  return url.origin;
}

export function buildSmokePlan(
  workerOrigin: string,
  marketplaceOrigin: string,
  options: SmokeOptions = {},
): readonly SmokeTarget[] {
  const worker = normalizeOrigin(workerOrigin, "worker origin");
  const marketplace = normalizeOrigin(marketplaceOrigin, "marketplace origin");
  return [
    {
      label: "worker health",
      url: `${worker}/health`,
      check: (status, body) => {
        const health = record(body);
        if (status !== 200 || !health) return `expected 200 JSON, got ${status}`;
        if (health.status !== "ok" && health.status !== "degraded") return `unexpected status ${String(health.status)}`;
        if (health.plan !== "free" && health.plan !== "paid") return "plan is missing";
        if (typeof health.killSwitch !== "boolean" || typeof health.producerKillSwitch !== "boolean") {
          return "kill switches are missing";
        }
        if (options.expectKillSwitch !== undefined && health.killSwitch !== options.expectKillSwitch) {
          return `killSwitch is ${String(health.killSwitch)}, expected ${String(options.expectKillSwitch)}`;
        }
        return null;
      },
    },
    {
      label: "worker catalogue",
      url: `${worker}/catalog-agents?limit=1`,
      check: (status, body) => status === 200 && Array.isArray(record(body)?.items)
        ? null
        : `expected 200 with items, got ${status}`,
    },
    {
      label: "worker hire events",
      url: `${worker}/hire-events?chainId=56&agentId=${AGENT_ID}`,
      check: (status, body) => status === 200 && record(body)?.schemaVersion === 1 && Array.isArray(record(body)?.events)
        ? null
        : `expected 200 with events, got ${status}`,
    },
    {
      label: "marketplace agents",
      url: `${marketplace}/api/marketplace/agents?limit=1`,
      check: (status, body) => status === 200 && Array.isArray(record(body)?.items)
        ? null
        : `expected 200 with items, got ${status}`,
    },
    {
      label: "marketplace passport",
      url: `${marketplace}/api/marketplace/agents/${AGENT_ID}/passport`,
      check: (status, body) => {
        const passport = record(body);
        const checks = record(passport?.checks);
        return status === 200 && passport?.schemaVersion === 1 && checks !== null && record(checks.hireActivity) !== null
          ? null
          : `expected 200 Passport with hireActivity, got ${status}`;
      },
    },
    {
      label: "marketplace testnet job",
      url: `${marketplace}/api/marketplace/jobs/testnet/${TESTNET_JOB_ID}`,
      check: (status, body) => {
        const tracking = record(body);
        return status === 200 && (tracking?.liveStatus === "verified" || tracking?.liveStatus === "unavailable")
          ? null
          : `expected 200 tracking, got ${status}`;
      },
    },
  ];
}

export async function runSmoke(
  plan: readonly SmokeTarget[],
  fetchImpl: typeof fetch = fetch,
): Promise<readonly SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const target of plan) {
    try {
      const response = await fetchImpl(target.url, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      results.push({ label: target.label, url: target.url, status: response.status, problem: target.check(response.status, body) });
    } catch (error) {
      results.push({ label: target.label, url: target.url, status: null, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export function evaluate(results: readonly SmokeResult[]): { ok: boolean; lines: readonly string[] } {
  const lines = results.map((result) => [
    result.problem === null ? "ok  " : "FAIL",
    result.label,
    result.url,
    result.status === null ? "" : `-> ${result.status}`,
    result.problem === null ? "" : `(${result.problem})`,
  ].filter((part) => part !== "").join(" "));
  return { ok: results.length > 0 && results.every((result) => result.problem === null), lines };
}

export function parseArguments(argv: readonly string[]): {
  workerOrigin: string;
  marketplaceOrigin: string;
  options: SmokeOptions;
} {
  const positional: string[] = [];
  const options: { expectKillSwitch?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--expect-kill-switch") {
      const value = argv[index + 1];
      if (value !== "0" && value !== "1") throw new Error("--expect-kill-switch takes 0 or 1");
      options.expectKillSwitch = value === "1";
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown flag ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 2) {
    throw new Error("Usage: smoke <worker-origin> <marketplace-origin> [--expect-kill-switch 0|1]");
  }
  return { workerOrigin: positional[0]!, marketplaceOrigin: positional[1]!, options };
}

async function main(): Promise<void> {
  const { workerOrigin, marketplaceOrigin, options } = parseArguments(process.argv.slice(2));
  const results = await runSmoke(buildSmokePlan(workerOrigin, marketplaceOrigin, options));
  const { ok, lines } = evaluate(results);
  for (const line of lines) console.log(line);
  console.log(ok ? "smoke: ok" : "smoke: FAILED");
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
