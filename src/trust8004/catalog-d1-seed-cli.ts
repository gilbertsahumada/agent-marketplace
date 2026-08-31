import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { marketplaceInventoryEntries } from "../data/inventory/marketplace-inventory.ts";
import { buildCatalogD1Seed } from "./catalog-d1-seed.ts";
import { computeCatalogSnapshotSha256, type CatalogSnapshotV2 } from "./catalog-snapshot.ts";

interface Options { input: string; output: string }

export function parseCatalogD1SeedOptions(args: string[]): Options {
  let input: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--input" && argument !== "--output") throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a file path`);
    if (argument === "--input") input = resolve(value);
    else output = resolve(value);
    index += 1;
  }
  if (!input) throw new Error("--input is required");
  return { input, output: output ?? `${input}.d1.sql` };
}

async function writeExclusive(destination: string, contents: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const options = parseCatalogD1SeedOptions(process.argv.slice(2));
  const snapshot = JSON.parse(await readFile(options.input, "utf8")) as CatalogSnapshotV2;
  if (computeCatalogSnapshotSha256(snapshot) !== snapshot.sourceSha256) {
    throw new Error("CATALOG_SEED_SOURCE_HASH_MISMATCH");
  }
  const inventory = marketplaceInventoryEntries();
  const result = buildCatalogD1Seed(snapshot, {
    priorityAgentIds: inventory.map((entry) => entry.agentId),
    marketplaceAgentIds: inventory.filter((entry) => entry.operator === "marketplace").map((entry) => entry.agentId),
    categoriesByAgentId: Object.fromEntries(inventory.map((entry) => [
      entry.agentId,
      entry.categories.map(({ category }) => category),
    ])),
  });
  await writeExclusive(options.output, result.sql);
  process.stdout.write(
    `Catalog D1 seed: ${options.output}\n`
    + `agents=${result.stats.agents} endpoints=${result.stats.endpoints} `
    + `declarations=${result.stats.declarations} representatives=${result.stats.probeRepresentatives}\n`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
