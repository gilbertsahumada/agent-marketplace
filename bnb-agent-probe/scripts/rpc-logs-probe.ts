import { createPublicClient, http } from "viem";
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
 *
 * Prints one line per range (accepted or the provider's error), then the
 * widest accepted range. Never stores or echoes the URL.
 */

const RANGES = [1_000n, 5_000n, 10_000n, 50_000n] as const;

function parseChain(argv: readonly string[]): 56 | 97 {
  const index = argv.indexOf("--chain");
  const value = index === -1 ? "56" : argv[index + 1];
  if (value === "56") return 56;
  if (value === "97") return 97;
  throw new Error("Expected --chain 56 or --chain 97");
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is required (BSC_RPC_URL or BSC_TESTNET_RPC_URL value)");
  const chainId = parseChain(process.argv.slice(2));
  const client = createPublicClient({ chain: chainId === 56 ? bsc : bscTestnet, transport: http(rpcUrl, { retryCount: 0 }) });
  const commerce = chainId === 56 ? BSC_COMMERCE : BSC_TESTNET_COMMERCE;
  const head = await client.getBlockNumber();
  console.log(`chain ${chainId} head ${head}`);
  let widest = 0n;
  for (const range of RANGES) {
    const toBlock = head - 30n;
    const fromBlock = toBlock - range + 1n;
    const startedAt = Date.now();
    try {
      const logs = await client.getLogs({ address: commerce, events: commerceEventsAbi, fromBlock, toBlock });
      const bytes = new TextEncoder().encode(JSON.stringify(logs, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).byteLength;
      console.log(`range ${range}: ok, ${logs.length} logs, ~${bytes} bytes, ${Date.now() - startedAt} ms`);
      widest = range;
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
      console.log(`range ${range}: rejected (${message})`);
      break;
    }
  }
  console.log(widest === 0n
    ? "widest accepted range: none — this provider cannot back the log indexer"
    : `widest accepted range: ${widest} blocks → COMMERCE_INDEX_BLOCKS_PER_RUN <= ${widest}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
