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

const NON_PUBLIC_IPV6 = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const;

function isPublicIpv6(hostname: string): boolean {
  const address = parseIpv6(hostname.replace(/^\[|\]$/g, "").toLowerCase());
  if (address === null) return false;
  return NON_PUBLIC_IPV6.every(([network, prefix]) => (
    !inIpv6Subnet(address, parseIpv6(network)!, prefix)
  ));
}

function parseIpv6(value: string): bigint | null {
  if (!/^[0-9a-f:.]+$/.test(value) || value.split("::").length > 2) return null;
  const halves = value.split("::");
  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const result: number[] = [];
    for (const part of half.split(":")) {
      if (/^[0-9a-f]{1,4}$/.test(part)) {
        result.push(Number.parseInt(part, 16));
        continue;
      }
      const ipv4 = part.split(".");
      if (ipv4.length !== 4 || ipv4.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) {
        return null;
      }
      const bytes = ipv4.map(Number);
      result.push((bytes[0]! << 8) | bytes[1]!, (bytes[2]! << 8) | bytes[3]!);
    }
    return result;
  };
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (left === null || right === null) return null;
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [...left, ...Array.from({ length: omitted }, () => 0), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n);
}

function inIpv6Subnet(address: bigint, network: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return address >> shift === network >> shift;
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
