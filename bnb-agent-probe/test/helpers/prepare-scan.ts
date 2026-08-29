import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

export interface AllowlistEntry {
  file: string;
  function: string;
  fingerprint: string;
  count: number;
  normative?: boolean;
}

export interface FoundCallsite {
  file: string;
  function: string;
  fingerprint: string;
  count: number;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function enclosingFunction(source: string, index: number): string {
  const head = source.slice(0, index).split("\n");
  for (let i = head.length - 1; i >= 0; i -= 1) {
    const line = head[i]!;
    const named = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
      ?? line.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=/)
      ?? line.match(/^\s{2}(?:async\s+)?(\w+)\s*\(/);
    const name = named?.[1];
    if (name && !["if", "for", "while", "switch", "return", "catch"].includes(name)) return name;
  }
  return "<module>";
}

function extractArgument(source: string, openParen: number): string {
  let i = openParen;
  let depth = 0;
  let inTemplate = false;
  for (; i < source.length; i += 1) {
    const char = source[i]!;
    if (inTemplate) {
      if (char === "\\") { i += 1; continue; }
      if (char === "`") inTemplate = false;
      continue;
    }
    if (char === "`") { inTemplate = true; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  throw new Error("Unbalanced .prepare( argument");
}

export function normalizeQuery(argument: string): string {
  return argument
    .replace(/\$\{[^}]*\}/g, "?")
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fingerprint(argument: string): string {
  return createHash("sha256").update(normalizeQuery(argument)).digest("hex").slice(0, 12);
}

export function scanPrepareCallsites(): FoundCallsite[] {
  const found = new Map<string, FoundCallsite>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, "utf8");
    const relPath = `src/${relative(SRC_ROOT, file)}`;
    for (let index = source.indexOf(".prepare("); index !== -1; index = source.indexOf(".prepare(", index + 1)) {
      const argument = extractArgument(source, index + ".prepare".length);
      const entryKey = [relPath, enclosingFunction(source, index), fingerprint(argument)].join("|");
      const existing = found.get(entryKey);
      if (existing) existing.count += 1;
      else {
        found.set(entryKey, {
          file: relPath,
          function: enclosingFunction(source, index),
          fingerprint: fingerprint(argument),
          count: 1,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) =>
    a.file.localeCompare(b.file) || a.function.localeCompare(b.function) || a.fingerprint.localeCompare(b.fingerprint));
}
