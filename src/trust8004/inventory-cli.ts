import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildBscCandidateInventory } from "./inventory.ts";
import { Trust8004Provider } from "./provider.ts";

function outputPath(args: string[]): string {
  const outputIndex = args.indexOf("--output");
  if (outputIndex === -1) return resolve(".marketplace/inventory/bsc-candidates.json");
  const value = args[outputIndex + 1];
  if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
  return resolve(value);
}

async function main(): Promise<void> {
  const destination = outputPath(process.argv.slice(2));
  const temporary = `${destination}.tmp`;
  const inventory = await buildBscCandidateInventory(new Trust8004Provider());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
  process.stdout.write(
    `Wrote ${inventory.agents.length} BSC candidates to ${destination} (catalogCoverage=partial)\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
