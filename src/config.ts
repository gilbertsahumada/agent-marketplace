import { getAddress, type Address } from "viem";

export const TESTNET_NETWORK = "bsc-testnet";
export const TESTNET_CHAIN_ID = 97;

export interface Gate1Config {
  agentId: number;
  buyerAddress: Address | null;
  buyerWalletPassword: string | null;
  buyerWalletsDir?: string;
  bearerToken: string | null;
  pollIntervalMs: number;
  submittedTimeoutMs: number;
  receiptDir: string;
}

export interface ReceiptConfig {
  receiptDir: string;
}

const FORBIDDEN_SECRET_ENV = [
  "PRIVATE_KEY",
  "BUYER_PRIVATE_KEY",
  "PROVIDER_PRIVATE_KEY",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

export function assertSafeEnvironment(env: Environment): void {
  const network = env.NETWORK ?? TESTNET_NETWORK;
  if (network !== TESTNET_NETWORK) {
    throw new Error(
      `Gate 1 is locked to ${TESTNET_NETWORK}; received NETWORK=${network}`,
    );
  }

  const contractOverrides = Object.keys(env).filter(
    (key) =>
      key === "ERC8004_REGISTRY_ADDRESS" ||
      /^ERC8183_.*_ADDRESS$/.test(key),
  );
  if (contractOverrides.length > 0) {
    throw new Error(
      `Gate 1 rejects contract overrides: ${contractOverrides.sort().join(", ")}`,
    );
  }

  const rawKeys = FORBIDDEN_SECRET_ENV.filter((key) => Boolean(env[key]));
  if (rawKeys.length > 0) {
    throw new Error(
      `Raw private-key variables are forbidden: ${rawKeys.join(", ")}. Use an existing encrypted keystore.`,
    );
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

export function loadConfig(
  env: Environment,
  agentIdArg?: string,
): Gate1Config {
  assertSafeEnvironment(env);
  const rawAgentId = agentIdArg ?? env.AGENT_ID;
  if (!rawAgentId || !/^\d+$/.test(rawAgentId)) {
    throw new Error("A numeric AGENT_ID or --agent-id is required");
  }
  const agentId = Number(rawAgentId);
  if (!Number.isSafeInteger(agentId)) {
    throw new Error("AGENT_ID exceeds JavaScript's safe integer range");
  }

  return {
    agentId,
    buyerAddress: env.BUYER_ADDRESS
      ? getAddress(env.BUYER_ADDRESS)
      : null,
    buyerWalletPassword: env.BUYER_WALLET_PASSWORD || null,
    ...(env.BUYER_WALLETS_DIR?.trim()
      ? { buyerWalletsDir: env.BUYER_WALLETS_DIR.trim() }
      : {}),
    bearerToken: env.AGENT_BEARER_TOKEN?.trim() || null,
    pollIntervalMs: positiveInteger(env.GATE1_POLL_INTERVAL_MS, 15_000),
    submittedTimeoutMs: positiveInteger(
      env.GATE1_SUBMITTED_TIMEOUT_MS,
      20 * 60_000,
    ),
    receiptDir: env.GATE1_RECEIPT_DIR?.trim() || ".gate1/receipts",
  };
}

export function loadReceiptConfig(env: Environment): ReceiptConfig {
  assertSafeEnvironment(env);
  return {
    receiptDir: env.GATE1_RECEIPT_DIR?.trim() || ".gate1/receipts",
  };
}

export interface CliArgs {
  command: "preflight" | "run" | "resume";
  agentId?: string;
  jobId?: string;
  execute: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  if (command !== "preflight" && command !== "run" && command !== "resume") {
    throw new Error("Expected command: preflight, run, or resume");
  }

  let agentId: string | undefined;
  let jobId: string | undefined;
  let execute = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--agent-id") {
      agentId = rest[index + 1];
      index += 1;
    } else if (arg === "--job-id") {
      jobId = rest[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (command === "resume") {
    if (!jobId || !/^\d+$/.test(jobId)) {
      throw new Error("resume requires --job-id <numeric-id>");
    }
    if (execute) throw new Error("resume is read-only and rejects --execute");
  } else if (jobId !== undefined) {
    throw new Error("--job-id is only valid with resume");
  }

  return {
    command,
    ...(agentId === undefined ? {} : { agentId }),
    ...(jobId === undefined ? {} : { jobId }),
    execute,
  };
}
