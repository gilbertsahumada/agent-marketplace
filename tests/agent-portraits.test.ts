// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MAX_BYTES = 12_288;
const PORTRAITS = ["grid", "rebalance", "yield", "loan-health"] as const;

const readPortrait = (name: string) =>
  readFileSync(join(process.cwd(), "public", "agents", `${name}.svg`), "utf8");

const stripXmlns = (svg: string) => svg.replace(/\sxmlns(?::[\w-]+)?="[^"]*"/g, "");

describe.each(PORTRAITS)("public/agents/%s.svg", (name) => {
  const svg = readPortrait(name);

  it("has a single root <svg> with a 512x512 viewBox", () => {
    const opens = svg.match(/<svg\b/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(svg.trimStart().startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toMatch(/<svg\b[^>]*\sviewBox="0 0 512 512"/);
  });

  it("is labelled for assistive technology", () => {
    expect(svg).toMatch(/<svg\b[^>]*\srole="img"/);
    expect(svg).toMatch(/<title\b[^>]*>[^<]+<\/title>/);
  });

  it("contains no scripts, foreign objects, remote references or data URIs", () => {
    expect(svg).not.toMatch(/<script\b/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
    expect(stripXmlns(svg)).not.toMatch(/https?:\/\//i);
    expect(svg).not.toMatch(/data:/i);
  });

  it(`is under ${MAX_BYTES} bytes`, () => {
    expect(Buffer.byteLength(svg, "utf8")).toBeLessThan(MAX_BYTES);
  });
});
