export type BrowserValidationProtocol = "a2a" | "mcp" | "erc8183_http";
export type BrowserValidationOutcome =
  | "protocol_valid"
  | "cors_blocked"
  | "http_error"
  | "timeout"
  | "invalid_response"
  | "unsafe_url";

export interface BrowserValidationTarget {
  protocol: BrowserValidationProtocol;
  endpoint: string;
}

export interface BrowserValidationResult {
  source: "browser_reported";
  protocol: BrowserValidationProtocol;
  endpoint: string;
  outcome: BrowserValidationOutcome;
  observedAt: string;
  expiresAt: string | null;
  httpStatus: number | null;
  durationMs: number;
  capabilityCount: number;
  errorCode: string | null;
  message: string;
  method: "GET" | "POST";
  cors: boolean;
}
