import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Activation-window rollback (SPEC section on the armed rollback): re-arms both
 * kill switches, removes the five-minute Cron and verifies the control plane
 * reports schedules empty with both switches at "1". Replaces the copy-paste
 * shell trap the README previously carried. DRY RUN by default: without
 * --execute it only prints the exact plan and performs no deploy, no HTTP call
 * and no evidence write.
 */

const ENCODED_CRON = "%2A%2F5%20%2A%20%2A%20%2A%20%2A";

export interface RollbackContext {
  readonly accountId: string;
  readonly scriptName: string;
  readonly fullSha: string;
  readonly shortSha: string;
  readonly allowNonStaging?: boolean;
}

export type RollbackStep =
  | { readonly kind: "wrangler"; readonly args: readonly string[] }
  | { readonly kind: "http"; readonly method: "DELETE"; readonly url: string }
  | { readonly kind: "verify"; readonly check: "schedules_empty" | "kill_switches_on"; readonly url: string };

export function buildRollbackPlan(context: RollbackContext): readonly RollbackStep[] {
  if (!/^[0-9a-f]{40}$/.test(context.fullSha)) {
    throw new Error("FULL_SHA must be a 40-hex commit");
  }
  if (!/^[0-9a-f]{7,12}$/.test(context.shortSha) || !context.fullSha.startsWith(context.shortSha)) {
    throw new Error("SHORT_SHA must be a hex prefix of FULL_SHA");
  }
  if (!/^[0-9a-f]{32}$/.test(context.accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-hex account id");
  }
  if (context.scriptName.length === 0 || /[^a-z0-9-]/.test(context.scriptName)) {
    throw new Error("WP2_SCRIPT_NAME must be a lowercase worker name");
  }
  if (!context.scriptName.endsWith("-staging") && context.allowNonStaging !== true) {
    throw new Error("Refusing rollback outside a -staging Worker without --allow-non-staging");
  }
  const scriptBase = `https://api.cloudflare.com/client/v4/accounts/${context.accountId}/workers/scripts/${context.scriptName}`;
  return [
    {
      kind: "wrangler",
      args: [
        "wrangler", "deploy", "--env", "staging", "--keep-vars",
        "--var", "PRODUCER_KILL_SWITCH:1", "--var", "KILL_SWITCH:1",
        "--message", `git_commit=${context.fullSha}`,
        "--tag", `git-${context.shortSha}-activation-abort`,
      ],
    },
    { kind: "http", method: "DELETE", url: `${scriptBase}/schedules/${ENCODED_CRON}` },
    { kind: "verify", check: "schedules_empty", url: `${scriptBase}/schedules` },
    { kind: "verify", check: "kill_switches_on", url: `${scriptBase}/settings` },
  ];
}

export function schedulesEmpty(payload: unknown): boolean {
  const body = payload as { success?: unknown; errors?: unknown; result?: { schedules?: unknown } };
  return body?.success === true
    && Array.isArray(body.errors) && body.errors.length === 0
    && Array.isArray(body.result?.schedules) && body.result.schedules.length === 0;
}

export function killSwitchesOn(payload: unknown): boolean {
  const body = payload as { success?: unknown; errors?: unknown; result?: { bindings?: unknown } };
  if (body?.success !== true || !Array.isArray(body.errors) || body.errors.length !== 0) {
    return false;
  }
  const bindings = body?.result?.bindings;
  if (!Array.isArray(bindings)) return false;
  const text = (name: string) => bindings.find((entry) =>
    typeof entry === "object" && entry !== null
    && (entry as { name?: unknown }).name === name) as { text?: unknown } | undefined;
  return text("PRODUCER_KILL_SWITCH")?.text === "1" && text("KILL_SWITCH")?.text === "1";
}

export interface RollbackExecutor {
  runWrangler(args: readonly string[]): Promise<void>;
  fetchJson(method: "GET" | "DELETE", url: string): Promise<unknown>;
}

export async function runRollback(
  plan: readonly RollbackStep[],
  executor: RollbackExecutor,
): Promise<void> {
  const errors: Error[] = [];
  for (const step of plan) {
    try {
      if (step.kind === "wrangler") {
        await executor.runWrangler(step.args);
      } else if (step.kind === "http") {
        await executor.fetchJson(step.method, step.url);
      } else {
        const payload = await executor.fetchJson("GET", step.url);
        const passed = step.check === "schedules_empty" ? schedulesEmpty(payload) : killSwitchesOn(payload);
        if (!passed) throw new Error(`verification failed: ${step.check}`);
      }
    } catch (error) {
      const label = step.kind === "verify" ? step.check : step.kind;
      errors.push(new Error(`Rollback step failed (${label})`, { cause: error }));
    }
  }
  if (errors.length !== 0) {
    throw new AggregateError(errors, `Rollback incomplete: ${errors.length} step(s) failed`);
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const context: RollbackContext = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    scriptName: process.env.WP2_SCRIPT_NAME ?? "bnb-agent-probe-staging",
    fullSha: process.env.FULL_SHA ?? "",
    shortSha: process.env.SHORT_SHA ?? "",
    allowNonStaging: process.argv.includes("--allow-non-staging"),
  };
  const plan = buildRollbackPlan(context);
  for (const step of plan) {
    process.stdout.write(`${JSON.stringify(step)}\n`);
  }
  if (!execute) {
    process.stdout.write("dry-run: no command was executed (pass --execute to run)\n");
    return;
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required with --execute");
  const execFileAsync = promisify(execFile);
  await runRollback(plan, {
    runWrangler: async (args) => {
      await execFileAsync("npx", [...args], { timeout: 120_000 });
    },
    fetchJson: async (method, url) => {
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Rollback control-plane call failed: ${method} ${response.status}`);
      return response.json();
    },
  });
  process.stdout.write("rollback complete: schedules empty and both kill switches at 1\n");
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
