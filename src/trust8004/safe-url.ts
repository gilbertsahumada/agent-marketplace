import { isIP } from "node:net";
import { isPublicIpAddress } from "../verification/safe-http.ts";

const NON_PUBLIC_SUFFIXES = [
  ".example",
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
] as const;

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) return false;
  if (NON_PUBLIC_SUFFIXES.some((suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix))) {
    return false;
  }
  if (isIP(normalized) !== 0) return isPublicIpAddress(normalized);
  return normalized.length <= 253
    && normalized.includes(".")
    && normalized.split(".").every((label) => (
      label.length > 0
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ));
}

/**
 * Check an already-normalized HTTPS resource before exposing it to a browser.
 * This is intentionally syntactic: image rendering must not perform server-side
 * DNS resolution, but it must still reject credentials, private hosts and
 * URL components that can hide or alter the declared resource.
 */
export function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && isPublicHostname(url.hostname);
  } catch {
    return false;
  }
}
