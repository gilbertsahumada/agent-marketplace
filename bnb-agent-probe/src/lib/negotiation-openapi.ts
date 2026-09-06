import { normalizeNegotiationContract, type NegotiationContract } from "../../../src/shared/negotiation-input.ts";
import { NEGOTIATION_DETECTOR_VERSION } from "../../../src/shared/negotiation-profiles.ts";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function blocked(): never { throw new Error("NEGOTIATION_SCHEMA_UNSUPPORTED"); }

/** No network refs, composition, code execution, guessed operations or auth bypass.
 * Uses only the exact /negotiate path already supported by both transports.
 */
export function negotiationFromOpenApi(document: Record<string, unknown>, target: URL): NegotiationContract {
  if (!/^3\.(0|1)\./.test(String(document.openapi))) return blocked();
  const path = record(document.paths) ? document.paths[target.pathname] : undefined;
  if (!record(path) || !record(path.post)) return blocked();
  const operation = path.post;
  for (const node of [document, path, operation]) {
    if (node.servers !== undefined && (!Array.isArray(node.servers) || node.servers.some(server => {
      if (!record(server) || typeof server.url !== "string") return true;
      try { return new URL(server.url, target.origin).href.replace(/\/$/, "") !== target.origin; } catch { return true; }
    }))) return blocked();
  }
  const security = operation.security ?? document.security;
  if (security !== undefined && (!Array.isArray(security) || security.length > 0)) return blocked();
  for (const node of [path, operation]) {
    if (node.parameters !== undefined && (!Array.isArray(node.parameters) || node.parameters.length > 0)) return blocked();
  }
  let remaining = 100;
  function resolve(value: unknown, seen = new Set<string>(), depth = 0): unknown {
    if (--remaining < 0 || depth > 12) return blocked();
    if (Array.isArray(value)) return value.map(child => resolve(child, seen, depth + 1));
    if (!record(value)) return value;
    if (value.$ref !== undefined) {
      const ref = value.$ref;
      if (Object.keys(value).length !== 1 || typeof ref !== "string" || !/^#\/components\/(schemas|requestBodies)\/[A-Za-z0-9_-]+$/.test(ref) || seen.has(ref)) return blocked();
      const parts = ref.slice(2).split("/");
      let result: unknown = document;
      for (const part of parts) result = record(result) && Object.hasOwn(result, part) ? result[part] : undefined;
      if (!record(result)) return blocked();
      return resolve(result, new Set([...seen, ref]), depth + 1);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child, seen, depth + 1)]));
  }
  const body = resolve(operation.requestBody);
  const media = record(body) && record(body.content) ? body.content["application/json"] : undefined;
  if (!record(media)) return blocked();
  return normalizeNegotiationContract({ encoding: "request", inputSchema: media.schema,
    provenance: { profile: "seller-schema", source: "openapi", detectorVersion: NEGOTIATION_DETECTOR_VERSION },
  });
}
