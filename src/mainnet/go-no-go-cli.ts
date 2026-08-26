import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { evaluateMainnetGoNoGo } from "./go-no-go.ts";

async function main(): Promise<void> {
  const destination = resolve(".marketplace/mainnet/go-no-go.json");
  const report = await evaluateMainnetGoNoGo();
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  process.stdout.write(`Mainnet security decision: ${report.status.toUpperCase()}\n`);
  process.stdout.write(`Evidence: ${destination}\n`);
  if (report.status === "no_go") {
    process.stdout.write(`Unmet checks: ${report.reasons.join(", ")}\n`);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`Mainnet go/no-go failed: ${message}\n`);
  process.exitCode = 1;
});
