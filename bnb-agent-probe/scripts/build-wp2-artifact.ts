import { randomUUID } from "node:crypto";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildWp224hArtifact } from "../src/evidence/wp2-24h-artifact";

export async function writeWp224hArtifact(
  outputPath: string,
  windowStart: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const output = resolve(outputPath);
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  const artifact = await buildWp224hArtifact({
    accountId: environment.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: environment.WP2_D1_DATABASE_ID ?? "",
    queueId: environment.WP2_QUEUE_ID ?? "",
    windowStart,
    workerName: environment.WP2_SCRIPT_NAME ?? "bnb-agent-probe-staging",
  }, {
    readRawEvidence: (path) => readFile(resolve(path), "utf8"),
  });
  try {
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await link(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [outputPath, windowStart] = process.argv.slice(2);
  if (outputPath === undefined || windowStart === undefined) {
    throw new Error("usage: tsx scripts/build-wp2-artifact.ts <output.json> <window-start>");
  }
  await writeWp224hArtifact(outputPath, windowStart, process.env);
  process.stdout.write(`${resolve(outputPath)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
