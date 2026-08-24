import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

function contents(pattern: string): string {
  return globSync(pattern).map((file) => `${file}\n${readFileSync(file, "utf8")}`).join("\n");
}

function importedModules(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1]!);
}

function resolveLocalImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? new URL(specifier, `file://${process.cwd()}/${from}`).pathname.slice(process.cwd().length + 1)
      : null;
  if (!base) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")];
  return candidates.find((candidate) => globSync(candidate).length === 1) ?? null;
}

function clientReachableFiles(): Set<string> {
  const roots = globSync(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"])
    .filter((file) => /^\s*["']use client["'];/m.test(readFileSync(file, "utf8")));
  const visited = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of importedModules(file)) {
      const resolved = resolveLocalImport(file, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return visited;
}

describe("three-layer dependency boundaries", () => {
  it("keeps Next.js and React out of Business", () => {
    expect(contents("src/business/**/*.ts")).not.toMatch(/from ["'](?:next|react)(?:\/|["'])/);
  });

  it("keeps provider access out of API controllers", () => {
    expect(contents("app/api/**/*.ts")).not.toMatch(/src\/(?:data|trust8004|verification)|\bviem\b|@bnbagent\/sdk/);
  });

  it("keeps trust8004 and RPC access out of client presentation", () => {
    expect(contents("components/**/*.tsx")).not.toMatch(/src\/(?:trust8004|data)|\bviem\b|@bnbagent\/sdk/);
  });

  it("keeps page presentation dependent on Business instead of Data", () => {
    expect(contents("app/**/*.tsx")).not.toMatch(/src\/data/);
  });

  it("publishes no secret material in the versioned proof manifest", () => {
    const proof = readFileSync("src/data/proofs/gate1-job-514.ts", "utf8");
    expect(proof).not.toMatch(/private.?key|mnemonic|password|keystore|authorization|\.env|\/Users\//i);
  });

  it("keeps seller keys behind server-only boundaries", () => {
    const secretModules = [
      "src/data/erc8183/hosted-seller-config.ts",
      "src/mainnet/grid-seller-config.ts",
      "src/mainnet/mainnet-write-gate.ts",
    ];
    const clientFiles = clientReachableFiles();
    const clientSource = [...clientFiles].map((file) => readFileSync(file, "utf8")).join("\n");
    for (const secretModule of secretModules) {
      expect(readFileSync(secretModule, "utf8")).toMatch(/^import ["']server-only["'];/);
      expect(clientFiles).not.toContain(secretModule);
    }
    expect(contents("{app,components,src}/**/*.{ts,tsx}")).not.toMatch(/NEXT_PUBLIC_(?:MAINNET_)?SELLER_PRIVATE_KEY/);
    expect(contents("{app,components,src}/**/*.{ts,tsx}")).not.toMatch(/NEXT_PUBLIC_ERC8183_MAINNET_WRITES_ENABLED/);
    expect(clientSource).not.toMatch(/(?:MAINNET_)?SELLER_PRIVATE_KEY/);
    expect(clientSource).not.toMatch(/ERC8183_MAINNET_WRITES_ENABLED/);
  });

  it("never places a seller key in a log statement", () => {
    const sources = contents("{app,components,src}/**/*.{ts,tsx}");
    const logStatements = sources.match(/(?:console\.(?:log|error|warn|info|debug)|process\.(?:stdout|stderr)\.write)\([^\n]*/g) ?? [];
    expect(logStatements.join("\n")).not.toMatch(/(?:MAINNET_)?SELLER_PRIVATE_KEY|rawKey|privateKey/);
  });
});
