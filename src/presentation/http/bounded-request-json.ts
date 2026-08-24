export class BoundedRequestJsonError extends Error {
  constructor(
    readonly code: "BODY_TOO_LARGE" | "BODY_TIMEOUT" | "INVALID_JSON",
    message: string,
  ) {
    super(message);
    this.name = "BoundedRequestJsonError";
  }
}

export async function readBoundedRequestJson(
  request: Request,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BoundedRequestJsonError("BODY_TOO_LARGE", "Request body is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    reader.releaseLock();
    throw new BoundedRequestJsonError("BODY_TIMEOUT", "Request body timeout must be positive");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  let abortStarted = false;
  let rejectAbort!: (error: BoundedRequestJsonError) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abortRead = (message: string) => {
    if (abortStarted) return;
    abortStarted = true;
    const error = new BoundedRequestJsonError("BODY_TIMEOUT", message);
    rejectAbort(error);
    void reader.cancel(message).catch(() => undefined);
  };
  const onRequestAbort = () => abortRead("Request body was aborted");
  request.signal.addEventListener("abort", onRequestAbort, { once: true });
  if (request.signal.aborted) onRequestAbort();
  const timeout = setTimeout(() => abortRead("Request body timed out"), timeoutMs);
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        void reader.cancel("Request body exceeded the allowed size").catch(() => undefined);
        throw new BoundedRequestJsonError("BODY_TOO_LARGE", "Request body is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BoundedRequestJsonError) throw error;
    throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onRequestAbort);
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  }
}
