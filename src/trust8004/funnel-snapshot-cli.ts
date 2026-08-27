import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveNetwork } from "@bnbagent/sdk";
import { createPublicClient, defineChain, getAddress, http, type Address } from "viem";
import type { BscIdentityReader } from "../verification/onchain.ts";
import { canonicalJson, FUNNEL_PAGE_SIZE, runFunnelSnapshot } from "./funnel-snapshot.ts";

const bscHistoricalRpcUrl = "https://bsc-dataseed.bnbchain.org";

const walletIdentityAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

interface FunnelIdentityReaderDependencies {
  client: ReturnType<typeof createPublicClient>;
  registryAddress: Address;
}

function createNetworkDependencies(): FunnelIdentityReaderDependencies {
  const network = resolveNetwork("bsc-mainnet");
  const chain = defineChain({
    id: 56,
    name: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [bscHistoricalRpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(bscHistoricalRpcUrl) });
  const registryAddress: Address = getAddress(network.registryContract);
  return { client, registryAddress };
}

export function createFunnelIdentityReader(
  dependencies: FunnelIdentityReaderDependencies = createNetworkDependencies(),
): BscIdentityReader {
  const { client, registryAddress } = dependencies;
  return {
    registryAddress,
    assertChain: async () => {
      const chainId = await client.getChainId();
      if (chainId !== 56) throw new Error(`RPC chain mismatch: expected 56, received ${chainId}`);
    },
    getBlockNumber: () => client.getBlockNumber(),
    readIdentity: async (agentId, blockNumber) => {
      const tokenId = BigInt(agentId);
      const [owner, agentWallet] = await Promise.all([
        client.readContract({
          address: registryAddress,
          abi: walletIdentityAbi,
          functionName: "ownerOf",
          args: [tokenId],
          blockNumber,
        }),
        client.readContract({
          address: registryAddress,
          abi: walletIdentityAbi,
          functionName: "getAgentWallet",
          args: [tokenId],
          blockNumber,
        }),
      ]);
      return { owner, agentWallet, metadataUri: "" };
    },
  };
}

function filenameTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
}

function outputPath(args: string[], generatedAt: string): string {
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--output") throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
    output = value;
    index += 1;
  }
  return resolve(output ?? `evidence/funnel-bsc-${filenameTimestamp(generatedAt)}.json`);
}

async function writeExclusive(destination: string, contents: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
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
  const generatedAt = new Date().toISOString();
  const destination = outputPath(process.argv.slice(2), generatedAt);
  const snapshot = await runFunnelSnapshot({
    generatedAt,
    identityReader: createFunnelIdentityReader(),
    onPage: ({ pages, offset, processed, expectedTotal }) => {
      const isLastPage = offset + FUNNEL_PAGE_SIZE >= expectedTotal;
      if (pages % 10 === 0 || isLastPage) {
        process.stdout.write(
          `WP0 progress: pages=${pages} processed=${processed} expectedTotal=${expectedTotal}\n`,
        );
      }
    },
  });
  await writeExclusive(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
  const failedGates = snapshot.gates.filter((gate) => !gate.passed);
  process.stdout.write(
    `WP0 snapshot: ${destination}\n`
      + `agents=${snapshot.registeredTotal} pages=${snapshot.scan.pages} requests=${snapshot.scan.requests}\n`
      + `sourceSha256=${snapshot.sourceSha256}\n`
      + `canonicalBytes=${Buffer.byteLength(canonicalJson(snapshot))}\n`,
  );
  if (failedGates.length > 0) {
    process.stderr.write(`Failed gates: ${failedGates.map((gate) => gate.name).join(", ")}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
