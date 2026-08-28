import { CatalogSchemaError, parseCatalogAgent, parseCatalogPage } from "./parser.ts";
import { BSC_CHAIN_ID, type CatalogAgent, type CatalogPage } from "./types.ts";

export const DEFAULT_MAX_CATALOG_RESPONSE_BYTES = 16 * 1_024 * 1_024;

export interface Trust8004CatalogClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetch?: typeof fetch;
}

export class CatalogHttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`trust8004 catalog request failed with HTTP ${status} for ${url}`);
    this.name = "CatalogHttpError";
  }
}

export class CatalogRedirectError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`trust8004 catalog redirect blocked (${status}) for ${url}`);
    this.name = "CatalogRedirectError";
  }
}

export class CatalogBodyLimitError extends Error {
  constructor(readonly maximumBytes: number, readonly url: string) {
    super(`trust8004 catalog response exceeded ${maximumBytes} bytes for ${url}`);
    this.name = "CatalogBodyLimitError";
  }
}

export class CatalogTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly url: string) {
    super(`trust8004 catalog request timed out after ${timeoutMs} ms for ${url}`);
    this.name = "CatalogTimeoutError";
  }
}

export class CatalogInvalidJsonError extends Error {
  constructor(readonly url: string) {
    super(`trust8004 catalog returned invalid JSON for ${url}`);
    this.name = "CatalogInvalidJsonError";
  }
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

export class Trust8004CatalogClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Trust8004CatalogClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "https:") throw new Error("baseUrl must use HTTPS");
    this.baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.timeoutMs = positiveInteger(options.timeoutMs, "timeoutMs");
    this.maxResponseBytes = positiveInteger(options.maxResponseBytes, "maxResponseBytes");
    this.fetchImpl = options.fetch ?? fetch;
  }

  listHeader(limit: number): Promise<CatalogPage> {
    return this.list({ limit, offset: 0, sortOrder: "desc" });
  }

  listSweepPage(limit: number, offset: number): Promise<CatalogPage> {
    return this.list({ limit, offset, sortOrder: "asc" });
  }

  async getAgent(agentId: string): Promise<CatalogAgent> {
    if (!/^\d+$/.test(agentId) || agentId.length > 78) {
      throw new Error("agentId must be a numeric string");
    }
    const url = new URL(`${this.baseUrl}/agents/${BSC_CHAIN_ID}:${encodeURIComponent(agentId)}`);
    const agent = await this.request(url, (value) => parseCatalogAgent(value, "response"));
    if (agent.agentId !== agentId) {
      throw new CatalogSchemaError("response.agentId", `agentId ${agentId}`, agent.agentId);
    }
    return agent;
  }

  private async list(options: {
    limit: number;
    offset: number;
    sortOrder: "asc" | "desc";
  }): Promise<CatalogPage> {
    const limit = positiveInteger(options.limit, "limit");
    if (limit > 2_000) throw new Error("limit must not exceed 2000");
    if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }
    const url = new URL(`${this.baseUrl}/agents`);
    url.search = new URLSearchParams({
      chainId: String(BSC_CHAIN_ID),
      limit: String(limit),
      offset: String(options.offset),
      sortBy: "registered",
      sortOrder: options.sortOrder,
      includeReputation: "false",
      includeCategoryCounts: "false",
      includeMetadataReasonCounts: "false",
      includeTotal: "true",
    }).toString();
    return this.request(url, parseCatalogPage);
  }

  private async request<T>(url: URL, parse: (value: unknown) => T): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new CatalogTimeoutError(this.timeoutMs, url.toString()));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([this.fetchAndParse(url, controller.signal, parse), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchAndParse<T>(
    url: URL,
    signal: AbortSignal,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new CatalogTimeoutError(this.timeoutMs, url.toString());
      throw error;
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new CatalogRedirectError(response.status, url.toString());
    }
    if (!response.ok) throw new CatalogHttpError(response.status, url.toString());
    const text = await this.readBoundedText(response, url.toString());
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new CatalogInvalidJsonError(url.toString());
    }
    return parse(value);
  }

  private async readBoundedText(response: Response, url: string): Promise<string> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && /^\d+$/.test(declaredLength)
      && Number(declaredLength) > this.maxResponseBytes) {
      throw new CatalogBodyLimitError(this.maxResponseBytes, url);
    }
    if (response.body === null) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel();
        throw new CatalogBodyLimitError(this.maxResponseBytes, url);
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
}
