import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePublicVerificationSnapshot } from "../data/verification/public-verification-snapshot.js";
import { sanitizeVerificationReport, verificationReportFromReleaseInput } from "./publish.js";

interface PublishArguments {
  input: string;
  output: string;
  maxAgeHours: number;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function parsePublishArguments(args: string[]): PublishArguments {
  const rawAge = option(args, "--max-age-hours") ?? "72";
  const maxAgeHours = Number(rawAge);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("--max-age-hours must be a positive number");
  }
  return {
    input: resolve(option(args, "--input") ?? ".marketplace/readiness/bsc-marketplace.json"),
    output: resolve(option(args, "--output") ?? "src/data/verification/bsc-candidates-public.json"),
    maxAgeHours,
  };
}

export async function publishVerificationSnapshot(
  args: PublishArguments,
  now = Date.now(),
): Promise<void> {
  const source = JSON.parse(await readFile(args.input, "utf8")) as unknown;
  const snapshot = sanitizeVerificationReport(verificationReportFromReleaseInput(source), {
    now,
    maxAgeHours: args.maxAgeHours,
  });
  parsePublicVerificationSnapshot(snapshot);
  await mkdir(dirname(args.output), { recursive: true });
  const temporary = `${args.output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, args.output);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main(): Promise<void> {
  const args = parsePublishArguments(process.argv.slice(2));
  await publishVerificationSnapshot(args);
  process.stdout.write(`Published sanitized BSC verification snapshot to ${args.output}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`Verification snapshot publication failed: ${message}\n`);
    process.exitCode = 1;
  });
}
