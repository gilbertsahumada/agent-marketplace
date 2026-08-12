import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SECRET_KEY =
  /(private.?key|password|secret|authorization|bearer|access.?token|session|gateway.?token)/i;

export interface Gate1Receipt {
  schemaVersion: 1;
  sdkVersion: "0.5.0";
  updatedAt: string;
  phase: string;
  chainId: 97;
  agentId?: number;
  endpoint?: string;
  provider?: string;
  buyer?: string;
  quote?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  jobId?: string;
  status?: string;
  transactions?: Record<string, string>;
  notification?: Record<string, unknown>;
  deliverableUrl?: string | null;
  error?: string;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, entry]) => [key, redact(entry)]),
    );
  }
  if (typeof value === "string" && /\bBearer\s+\S+/i.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

export function receiptPath(receiptDir: string, id: string): string {
  return join(receiptDir, `${id}.json`);
}

export async function writeReceipt(
  path: string,
  receipt: Gate1Receipt,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const safe = redact({ ...receipt, updatedAt: new Date().toISOString() });
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(safe, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export async function readReceipt(path: string): Promise<Gate1Receipt> {
  return JSON.parse(await readFile(path, "utf8")) as Gate1Receipt;
}
