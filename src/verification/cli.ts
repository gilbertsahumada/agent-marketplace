import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Trust8004Provider } from "../trust8004/provider.ts";
import { createBscIdentityReader } from "./onchain.ts";
import { buildBscVerificationReport } from "./report.ts";
import type { BscVerificationReport } from "./types.ts";

export function parseOutputPath(args: string[]): string {
  const unknown = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const index = args.indexOf("--output");
  if (index === -1) return resolve(".marketplace/verification/bsc-candidates.json");
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
  return resolve(value);
}

function safeFatalMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/(bearer|token|password|secret)=?\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

export function verificationExitCode(report: BscVerificationReport): 0 | 2 {
  return report.summary.status === "attention_required" ? 2 : 0;
}

export async function writeVerificationReport(
  destination: string,
  report: BscVerificationReport,
): Promise<void> {
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

async function main(): Promise<void> {
  const destination = parseOutputPath(process.argv.slice(2));
  const report = await buildBscVerificationReport({
    provider: new Trust8004Provider(),
    identityReader: createBscIdentityReader(),
  });
  await writeVerificationReport(destination, report);
  process.stdout.write(
    `Wrote ${report.agents.length} BSC agent verifications to ${destination} (${report.summary.status})\n`,
  );
  process.exitCode = verificationExitCode(report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`BSC verification failed: ${safeFatalMessage(error)}\n`);
    process.exitCode = 1;
  });
}
