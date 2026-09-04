import { createPublicClient, http, TimeoutError } from "viem";
import { bsc, bscTestnet } from "viem/chains";

import { BSC_COMMERCE, BSC_TESTNET_COMMERCE } from "../src/lib/chain";
import { commerceEventsAbi } from "../src/routes/hire-events";

/**
 * Read-only capability probe for the Commerce indexer RPC. Public BSC RPCs
 * reject eth_getLogs above a few thousand blocks; the indexer's
 * COMMERCE_INDEX_BLOCKS_PER_RUN must stay at or below the widest range the
 * configured provider accepts. Run with the secret URL from the shell:
 *
 *   RPC_URL=https://… npm run rpc:probe -- --chain 56
 *   RPC_URL=https://… npm run rpc:probe -- --chain 97 --from 45000000
 *
 * `--from <block>` probes windows starting at that block (a busy window is a
 * more honest sample than the quiet default of head − 30). Prints one line per
 * range: accepted (with the reply size against the worker's cap), rejected by
 * the provider, or timed out (the provider did not answer within the client
 * timeout, which is not a range rejection). Never stores or echoes the URL:
 * only the first line of any error message is printed, because viem appends
 * the request URL on later lines.
 */

const RANGES = [1_000n, 5_000n, 10_000n, 50_000n] as const;
// Mirrors INDEX_RPC_RESPONSE_BYTES in src/phases/commerce-index.ts (2 MiB);
// hardcoded so this script does not pull the worker's D1 and queue code.
const WORKER_RESPONSE_CAP_BYTES = 2 * 1_024 * 1_024;

function parseChain(argv: readonly string[]): 56 | 97 {
  const index = argv.indexOf("--chain");
  const value = index === -1 ? "56" : argv[index + 1];
  if (value === "56") return 56;
  if (value === "97") return 97;
  throw new Error("Expected --chain 56 or --chain 97");
}

function parseFrom(argv: readonly string[]): bigint | null {
  const index = argv.indexOf("--from");
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || !/^\d{1,12}$/.test(value)) throw new Error("Expected --from <block number>");
  return BigInt(value);
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "";
}

// viem surfaces a client-side timeout as TimeoutError (possibly as the cause
// of a wrapping error); anything else from the transport is the provider's
// answer.
function isTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current instanceof TimeoutError || current.name === "TimeoutError") return true;
    current = current.cause;
  }
  return false;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is required (BSC_RPC_URL or BSC_TESTNET_RPC_URL value)");
  const argv = process.argv.slice(2);
  const chainId = parseChain(argv);
  const from = parseFrom(argv);
  const client = createPublicClient({ chain: chainId === 56 ? bsc : bscTestnet, transport: http(rpcUrl, { retryCount: 0 }) });
  const commerce = chainId === 56 ? BSC_COMMERCE : BSC_TESTNET_COMMERCE;
  const head = await client.getBlockNumber();
  if (from !== null && from > head) throw new Error(`--from ${from} is past the chain head ${head}`);
  console.log(`chain ${chainId} head ${head}${from === null ? "" : ` probing from ${from}`}`);
  let widest = 0n;
  let timedOut = false;
  for (const range of RANGES) {
    const fromBlock = from ?? head - 30n - range + 1n;
    const toBlock = from === null ? head - 30n : (from + range - 1n < head ? from + range - 1n : head);
    const startedAt = Date.now();
    try {
      const logs = await client.getLogs({ address: commerce, events: commerceEventsAbi, fromBlock, toBlock });
      const bytes = new TextEncoder().encode(JSON.stringify(logs, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).byteLength;
      const cap = bytes <= WORKER_RESPONSE_CAP_BYTES ? "fits" : "EXCEEDS";
      console.log(`range ${range} [${fromBlock}, ${toBlock}]: ok, ${logs.length} logs, ~${bytes} bytes (${cap} the worker cap of ${WORKER_RESPONSE_CAP_BYTES}), ${Date.now() - startedAt} ms`);
      if (bytes > WORKER_RESPONSE_CAP_BYTES) break;
      widest = range;
    } catch (error) {
      if (isTimeout(error)) {
        timedOut = true;
        console.log(`range ${range} [${fromBlock}, ${toBlock}]: timed out after ${Date.now() - startedAt} ms (no answer from the provider; not a range rejection)`);
      } else {
        console.log(`range ${range} [${fromBlock}, ${toBlock}]: rejected by the provider (${firstLine(error)})`);
      }
      break;
    }
  }
  if (widest === 0n) {
    console.log(timedOut
      ? "widest accepted range: none — the smallest window timed out; retry, or treat this provider as too slow for the log indexer"
      : "widest accepted range: none — this provider cannot back the log indexer");
    return;
  }
  console.log(`widest accepted range: ${widest} blocks → COMMERCE_INDEX_BLOCKS_PER_RUN <= ${widest}${timedOut ? " (the next range timed out rather than being rejected; a wider window may still be accepted)" : ""}`);
}

main().catch((error: unknown) => {
  console.error(firstLine(error));
  process.exitCode = 1;
});
