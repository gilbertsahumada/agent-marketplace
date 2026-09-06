import { readFile, writeFile } from "node:fs/promises";
import { discoveryInventory } from "./discovery-audit.ts";
import { createSafeEndpointTransport } from "../verification/safe-http.ts";
import { discoverNegotiationInput } from "../../bnb-agent-probe/src/lib/seller-client.ts";

// Read-only audit of saved public catalogue pages. No negotiation, wallet calls,
// D1 mutation or promotion to ready is performed by this command.
const [chainRaw, output, limitRaw, ...paths] = process.argv.slice(2);
const chainId = Number(chainRaw);
const limit = Number(limitRaw);
if ((chainId !== 56 && chainId !== 97) || !output || !paths.length || !Number.isSafeInteger(limit) || limit < 0 || limit > 500) throw new Error("Usage: discovery-audit-cli 56|97 output.json 0..500 page.json...");
const outputPath = output;
const pages = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, "utf8"))));
const sourceItems = pages.flatMap(page => page.items);
const skippedReady = sourceItems.filter(item => item.state?.canRequestQuote === true).length;
const items = sourceItems.filter(item => item.state?.canRequestQuote !== true).map(item => Array.isArray(item.declarations) ? {
  ...item, services: item.declarations.map((declaration: { protocol: string; endpoint: string }) => ({
    name: declaration.protocol === "erc8183_http" ? "ERC8183" : declaration.protocol,
    endpoint: declaration.endpoint,
  })),
} : item);
const inventory = discoveryInventory(items, chainId);
const complete = pages.every(page => page.total === inventory.registered + skippedReady);
type AuditResult = typeof inventory.targets[number] & { result: string; checkedAt: string; code?: string; durationMs: number; contract?: unknown };
let results: AuditResult[] = [];
try {
  const prior = JSON.parse(await readFile(output, "utf8"));
  if (prior.chainId !== chainId || !Array.isArray(prior.results)) throw new Error("AUDIT_RESUME_INVALID");
  results = prior.results;
} catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
const checked = new Set(results.map(result => `${result.transport}:${result.endpoint}`));
const pending = inventory.targets.filter(target => !checked.has(`${target.transport}:${target.endpoint}`)).slice(0, limit);
const activeOrigins = new Set<string>();
let writing = Promise.resolve();
async function worker() {
while (pending.length) {
  const index = pending.findIndex(target => !activeOrigins.has(new URL(target.endpoint).origin));
  if (index < 0) return;
  const target = pending.splice(index, 1)[0]!;
  const origin = new URL(target.endpoint).origin;
  activeOrigins.add(origin);
  const started = Date.now();
  let transport: Awaited<ReturnType<typeof createSafeEndpointTransport>> | undefined;
  try {
    transport = await createSafeEndpointTransport(target.endpoint, { timeoutMs: 5_000, maxResponseBytes: 32_768 });
    const contract = await discoverNegotiationInput({ ...target, request: {}, timeoutMs: 5_000, maxResponseBytes: 32_768, fetch: transport.fetch });
    results.push({ ...target, result: "inputs_supported", contract, checkedAt: new Date().toISOString(), durationMs: Date.now() - started });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DISCOVERY_NETWORK_OR_SCHEMA_ERROR";
    results.push({ ...target, result: "not_verified", code, checkedAt: new Date().toISOString(), durationMs: Date.now() - started });
  } finally { await transport?.close(); activeOrigins.delete(origin); }
  writing = writing.then(() => writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), inventoryComplete: complete, skippedReady, ...inventory, checkedEndpoints: results.length, results }, null, 2)));
  await writing;
  console.log(`${results.length}/${inventory.targets.length} ${target.transport}: ${results.at(-1)?.result}`);
}
}
await Promise.all([worker(), worker(), worker()]);
await writing;
await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), inventoryComplete: complete, skippedReady, ...inventory, checkedEndpoints: results.length, results }, null, 2));
console.log(JSON.stringify({ registered: inventory.registered, withDeclarations: inventory.withDeclarations, safeOperationalAgents: inventory.safeOperationalAgents, uniqueEndpoints: inventory.targets.length, complete, output }));
