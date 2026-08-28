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
];

function isPublicIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function isPublicIpv6(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!address.includes(":")) return false;
  if (address === "::" || address === "::1") return false;
  if (address.startsWith("fc") || address.startsWith("fd")) return false;
  if (/^fe[89abcdef]/.test(address)) return false;
  if (address.startsWith("ff") || address.startsWith("2001:db8:")) return false;
  if (address.includes("::ffff:")) return false;
  return /^[0-9a-f:]+$/.test(address);
}

function isDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || !hostname.includes(".")) return false;
  if (NON_PUBLIC_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    return false;
  }
  return hostname.split(".").every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

export function isSyntacticallyPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("[") && hostname.endsWith("]")) return isPublicIpv6(hostname);
    if (/^[\d.]+$/.test(hostname)) return isPublicIpv4(hostname);
    return isDnsHostname(hostname);
  } catch {
    return false;
  }
}
