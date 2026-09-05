import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsciiBnbMark } from "@/components/marketplace/ascii-bnb-mark";
import { BNB_ASCII_MARK, BNB_ASCII_MARK_COLUMNS, rasterizeAsciiMark } from "@/components/marketplace/bnb-ascii-mark";

const SOLID = "#";

describe("BNB ASCII mark", () => {
  it("keeps the symbol's square proportions in character cells", () => {
    // 44 columns × 0.65 cell aspect × (96 / 82.2857) tall-over-wide → 33 rows.
    expect(BNB_ASCII_MARK).toHaveLength(33);
    expect(Math.max(...BNB_ASCII_MARK.map((line) => line.length))).toBe(BNB_ASCII_MARK_COLUMNS);
  });

  it("is mirror-symmetric like the source outline", () => {
    for (const line of BNB_ASCII_MARK) {
      const padded = line.padEnd(BNB_ASCII_MARK_COLUMNS, " ");
      expect(padded).toBe(Array.from(padded).reverse().join(""));
    }
  });

  it("draws the five diamonds as solid shapes with clean edges instead of dithered noise", () => {
    const middle = BNB_ASCII_MARK[Math.floor(BNB_ASCII_MARK.length / 2)]!;
    expect(middle).toMatch(/#{8,}/);
    // The centre diamond is separated from the side diamonds by real gaps.
    expect(middle.trim().split(/\s{2,}/).length).toBeGreaterThanOrEqual(3);
    // Only ramp characters, no dither leftovers.
    for (const line of BNB_ASCII_MARK) expect(line).toMatch(/^[ .:\-=+*#]*$/);
    const solidCells = BNB_ASCII_MARK.join("").split(SOLID).length - 1;
    expect(solidCells).toBeGreaterThan(300);
  });

  it("rasterizes at other sizes without breaking symmetry", () => {
    const small = rasterizeAsciiMark({ columns: 24 });
    expect(small).toHaveLength(18);
    for (const line of small) {
      const padded = line.padEnd(24, " ");
      expect(padded).toBe(Array.from(padded).reverse().join(""));
    }
  });

  it("renders server-side as an image with one span per glyph", () => {
    const html = renderToStaticMarkup(AsciiBnbMark({ lines: ["#.#", " # "] }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="BNB Chain symbol rendered as ASCII"');
    expect(html.match(/market-ascii-char/g)).toHaveLength(4);
    expect(html.match(/market-ascii-line/g)).toHaveLength(2);
  });
});
