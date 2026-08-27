import { randomUUID } from "node:crypto";
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import { pathToFileURL } from "node:url";
import { AgentEndpoint, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import {
  ERC8183Client,
  ERC8183JobOps,
  JobStatus,
  NegotiationHandler,
} from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";
import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { getAddress } from "viem";
import {
  loadSellerConfig,
  parseSellerCommand,
  type SellerConfig,
} from "./seller-config.ts";
import { GATE1_NETWORK } from "./network.ts";

type JsonObject = Record<string, unknown>;
const GATE1_FIXTURE_AGENT_ID = 1815;

export function fundedNotificationDisposition(status: number): "submit" | "already_submitted" | "reject" {
  if (status === JobStatus.FUNDED) return "submit";
  if (status === JobStatus.SUBMITTED || status === JobStatus.COMPLETED) return "already_submitted";
  return "reject";
}

export function buildAgentCard(baseUrl: string): JsonObject {
  return {
    protocolVersion: "0.3.0",
    name: "gate1-erc8183-seller-fixture",
    description:
      "Controlled test infrastructure for the Gate 1 ERC-8183 buyer spike.",
    url: `${baseUrl}/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "negotiate-erc8183-job",
        name: "Negotiate an ERC-8183 fixture job",
        description: "Return a provider-signed ERC-8183 quote.",
        tags: ["erc8183", "testing", "bnb-chain"],
      },
      {
        id: "negotiate",
        name: "Negotiate an ERC-8183 fixture job",
        description: "Return a provider-signed ERC-8183 quote.",
        tags: ["erc8183", "testing", "bnb-chain"],
      },
      {
        id: "notify_funded",
        name: "Submit a funded ERC-8183 fixture job",
        description: "Verify a FUNDED job and submit a deterministic result.",
        tags: ["erc8183", "testing", "bnb-chain"],
      },
    ],
  };
}

export function extractDataPart(body: unknown): {
  id: unknown;
  data: JsonObject;
} {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid JSON-RPC request");
  }
  const rpc = body as JsonObject;
  if (rpc.jsonrpc !== "2.0" || rpc.method !== "message/send") {
    throw new Error("Expected JSON-RPC message/send");
  }
  const params = rpc.params as JsonObject | undefined;
  const message = params?.message as JsonObject | undefined;
  const parts = message?.parts;
  if (!Array.isArray(parts)) throw new Error("Message has no parts");
  const part = parts.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as JsonObject).kind === "data",
  ) as JsonObject | undefined;
  if (typeof part?.data !== "object" || part.data === null) {
    throw new Error("Message has no data part");
  }
  return { id: rpc.id, data: part.data as JsonObject };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function rpcResult(res: ServerResponse, id: unknown, data: JsonObject): void {
  sendJson(res, 200, {
    jsonrpc: "2.0",
    id,
    result: {
      kind: "message",
      role: "agent",
      messageId: randomUUID(),
      parts: [{ kind: "data", data }],
    },
  });
}

function rpcError(
  res: ServerResponse,
  id: unknown,
  message: string,
  status = 200,
): void {
  sendJson(res, status, {
    jsonrpc: "2.0",
    id,
    error: { code: -32602, message },
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function loadExistingWallet(config: SellerConfig): EVMWalletProvider {
  if (
    !EVMWalletProvider.keystoreExists(config.address, config.walletsDir)
  ) {
    throw new Error(
      `No existing encrypted seller keystore found for ${config.address}; wallet creation is outside this fixture`,
    );
  }
  const wallet = new EVMWalletProvider({
    password: config.walletPassword,
    address: config.address,
    ...(config.walletsDir ? { walletsDir: config.walletsDir } : {}),
  });
  if (getAddress(wallet.address) !== config.address) {
    throw new Error("Loaded seller keystore does not match SELLER_ADDRESS");
  }
  return wallet;
}

async function register(config: SellerConfig): Promise<void> {
  const wallet = loadExistingWallet(config);
  const identity = await ERC8004Agent.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
  });
  const agentUri = identity.generateAgentUri({
    name: "gate1-erc8183-seller-fixture",
    description:
      "Controlled test infrastructure for the Gate 1 ERC-8183 buyer spike.",
    endpoints: [AgentEndpoint.a2a(config.baseUrl, { version: "0.3.0" })],
  });
  const result = await identity.registerAgent(agentUri);
  console.log(
    JSON.stringify({
      fixture: true,
      chainId: 97,
      provider: wallet.address,
      endpoint: config.baseUrl,
      transactionHash: result.transactionHash,
      agentId: result.agentId,
    }),
  );
}

export function assertFixtureAgentOwner(
  owner: string,
  walletAddress: string,
): void {
  if (getAddress(owner) !== getAddress(walletAddress)) {
    throw new Error(
      `Seller wallet is not the owner of fixture Agent ${GATE1_FIXTURE_AGENT_ID}`,
    );
  }
}

async function update(config: SellerConfig): Promise<void> {
  const wallet = loadExistingWallet(config);
  const identity = await ERC8004Agent.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
  });
  const current = await identity.getAgentInfo(GATE1_FIXTURE_AGENT_ID);
  assertFixtureAgentOwner(current.owner, wallet.address);
  const agentUri = identity.generateAgentUri({
    name: "gate1-erc8183-seller-fixture",
    description:
      "Controlled test infrastructure for the Gate 1 ERC-8183 buyer spike.",
    endpoints: [AgentEndpoint.a2a(config.baseUrl, { version: "0.3.0" })],
    agentId: GATE1_FIXTURE_AGENT_ID,
  });
  const result = await identity.setAgentUri(GATE1_FIXTURE_AGENT_ID, agentUri);
  console.log(
    JSON.stringify({
      fixture: true,
      chainId: 97,
      provider: wallet.address,
      endpoint: config.baseUrl,
      transactionHash: result.transactionHash,
      agentId: GATE1_FIXTURE_AGENT_ID,
    }),
  );
}

async function serve(config: SellerConfig): Promise<void> {
  const wallet = loadExistingWallet(config);
  const client = await ERC8183Client.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
  });
  const chainId = await client.publicClient.getChainId();
  if (chainId !== 97) throw new Error(`Expected chain 97, received ${chainId}`);
  const paymentToken = await client.paymentToken();
  const negotiation = await NegotiationHandler.fromErc8183Client(client, {
    servicePrice: config.servicePrice.toString(),
    walletProvider: wallet,
  });
  const jobOps = await ERC8183JobOps.create({
    walletProvider: wallet,
    network: GATE1_NETWORK,
    storageProvider: new LocalStorageProvider(config.storageDir),
    servicePrice: config.servicePrice,
    agentUrl: `${config.baseUrl}/erc8183`,
  });
  const card = buildAgentCard(config.baseUrl);

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (
        req.method === "GET" &&
        url.pathname === "/.well-known/agent-card.json"
      ) {
        return sendJson(res, 200, card);
      }
      const responseMatch = url.pathname.match(
        /^\/erc8183\/job\/(\d+)\/response$/,
      );
      if (req.method === "GET" && responseMatch) {
        const result = await jobOps.getResponse(Number(responseMatch[1]));
        return sendJson(res, result.success ? 200 : 404, result);
      }
      if (req.method !== "POST" || url.pathname !== "/a2a") {
        return sendJson(res, 404, { error: "Not found" });
      }

      let request: ReturnType<typeof extractDataPart>;
      try {
        request = extractDataPart(await readJson(req));
      } catch (error) {
        return rpcError(
          res,
          null,
          error instanceof Error ? error.message : "Invalid request",
          400,
        );
      }
      if (request.data.skill === "negotiate-erc8183-job" || request.data.skill === "negotiate") {
        const task = request.data.task_description;
        const terms = request.data.terms;
        if (typeof task !== "string" || typeof terms !== "object" || !terms) {
          return rpcError(res, request.id, "Invalid negotiation request");
        }
        const quote = await negotiation.negotiate({
          task_description: task,
          terms: terms as JsonObject,
        });
        return rpcResult(res, request.id, {
          ...quote.toDict(),
          provider_address: wallet.address,
        });
      }
      if (request.data.skill === "notify_funded") {
        const jobId = request.data.job_id;
        if (
          typeof jobId !== "number" ||
          !Number.isSafeInteger(jobId) ||
          jobId < 0
        ) {
          return rpcError(res, request.id, "notify_funded requires an integer job_id");
        }
        const current = await jobOps.getJob(Number(jobId));
        const disposition = fundedNotificationDisposition(
          typeof current.status === "number" ? current.status : -1,
        );
        if (disposition === "already_submitted") {
          return rpcResult(res, request.id, {
            acknowledged: true,
            already_submitted: true,
            job_id: jobId,
          });
        }
        if (disposition === "reject") {
          return rpcError(res, request.id, "notify_funded requires an onchain FUNDED job");
        }
        const result = await jobOps.submitResult(
          Number(jobId),
          `Gate 1 seller fixture completed job ${jobId}`,
          { fixture: "gate1-erc8183-seller", deterministic: true },
        );
        if (!result.success) {
          return rpcError(
            res,
            request.id,
            `${result.error_code ?? "submission_failed"}: ${result.error ?? "unknown error"}`,
          );
        }
        console.info(`[seller] submitted job ${jobId}, tx=${result.txHash}`);
        return rpcResult(res, request.id, {
          acknowledged: true,
          job_id: jobId,
          transaction_hash: result.txHash,
        });
      }
      return rpcError(res, request.id, "Unknown skill");
    })().catch(() => {
      console.error("[seller] request failed");
      if (!res.headersSent) rpcError(res, null, "Internal error", 500);
    });
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.info(
      JSON.stringify({
        fixture: true,
        chainId,
        provider: wallet.address,
        endpoint: config.baseUrl,
        localPort: config.port,
        paymentToken,
        servicePriceRaw: config.servicePrice.toString(),
      }),
    );
  });
}

async function main(): Promise<void> {
  const command = parseSellerCommand(process.argv.slice(2));
  const config = loadSellerConfig(process.env, command);
  if (command === "register") await register(config);
  else if (command === "update") await update(config);
  else await serve(config);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
