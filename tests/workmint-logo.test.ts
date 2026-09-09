import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the same flat Workmint symbol in the brand, favicon and social preview", () => {
  const symbol = readFileSync("public/logo/workmint-symbol.svg", "utf8");
  const favicon = readFileSync("app/icon.svg", "utf8");
  const social = readFileSync("app/opengraph-image.tsx", "utf8");
  const brand = readFileSync("components/marketplace/site-brand.tsx", "utf8");
  const path = symbol.match(/d="([^"]+)"/)?.[1];
  expect(path).toBeTruthy();
  expect(favicon).toContain(`d="${path}"`);
  expect(social).toContain(`d="${path}"`);
  expect(brand).toContain('/logo/workmint-symbol.svg');
  expect(symbol).toContain('fill="#FFE900"');
  expect(symbol).not.toMatch(/<image|<filter|<rect/);
});
