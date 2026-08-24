export class BoundedRequestJsonError extends Error {
  constructor(
    readonly code: "BODY_TOO_LARGE" | "INVALID_JSON",
    message: string,
  ) {
    super(message);
    this.name = "BoundedRequestJsonError";
  }
}

export async function readBoundedRequestJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BoundedRequestJsonError("BODY_TOO_LARGE", "Request body is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("Request body exceeded the allowed size").catch(() => undefined);
        throw new BoundedRequestJsonError("BODY_TOO_LARGE", "Request body is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof BoundedRequestJsonError) throw error;
    throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoundedRequestJsonError("INVALID_JSON", "Request body must be valid JSON");
  }
}
