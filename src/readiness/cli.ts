import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Trust8004Provider } from "../trust8004/provider.js";
import { createBscIdentityReader } from "../verification/onchain.js";
import { createGate1ProofReader } from "./gate1.js";
import { buildBscMarketplaceReadinessReport } from "./report.js";
import type { BscMarketplaceReadinessReport } from "./types.js";

export function parseOutputPath(args: string[]): string {
  const unknown = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const index = args.indexOf("--output");
  if (index === -1) return resolve(".marketplace/readiness/bsc-marketplace.json");
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
  return resolve(value);
}

export function readinessExitCode(report: BscMarketplaceReadinessReport): 0 | 2 {
  return report.frontendReady ? 0 : 2;
}

export async function writeReadinessReport(
  destination: string,
  report: BscMarketplaceReadinessReport,
): Promise<void> {
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

function safeFatalMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/(bearer|token|password|secret)=?\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const destination = parseOutputPath(process.argv.slice(2));
  const report = await buildBscMarketplaceReadinessReport({
    provider: new Trust8004Provider(),
    identityReader: createBscIdentityReader(),
    gate1Reader: await createGate1ProofReader(),
  });
  await writeReadinessReport(destination, report);
  process.stdout.write(
    `Wrote BSC marketplace readiness report to ${destination} (frontendReady=${report.frontendReady})\n`,
  );
  process.exitCode = readinessExitCode(report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`BSC readiness failed: ${safeFatalMessage(error)}\n`);
    process.exitCode = 1;
  });
}
