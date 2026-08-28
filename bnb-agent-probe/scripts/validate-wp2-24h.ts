import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { validateWp224hArtifact } from "../src/evidence/wp2-24h-artifact";

const artifactPath = process.argv[2];
if (artifactPath === undefined) {
  throw new Error("usage: tsx scripts/validate-wp2-24h.ts <artifact.json>");
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const artifact = JSON.parse(await readFile(resolve(artifactPath), "utf8")) as unknown;
const summary = await validateWp224hArtifact(artifact, {
  readRawEvidence: (path) => readFile(resolve(repositoryRoot, path), "utf8"),
});

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
