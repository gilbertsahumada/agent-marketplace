import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALT_GLYPHS, AsciiClouds, GLYPHS, cloudDensity, glowAt, glyphAt, glyphFor, mutates, shimmer } from "@/components/marketplace/ascii-clouds";

describe("ASCII clouds", () => {
  it("keeps the noise field inside [0, 1] and drifting with time", () => {
    let min = 1;
    let max = 0;
    for (let y = 0; y < 40; y += 1) for (let x = 0; x < 60; x += 1) {
      const value = cloudDensity(x * 0.09, y * 0.14, 0);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.3);
    expect(cloudDensity(3, 2, 0)).not.toBe(cloudDensity(3, 2, 30));
    // Twinkle stays small and oscillates, so it never flips whole regions.
    expect(Math.abs(shimmer(4, 7, 1.3))).toBeLessThanOrEqual(0.07);
    expect(shimmer(4, 7, 0)).not.toBe(shimmer(4, 7, 0.4));
  });

  it("maps low density to empty cells and higher density to denser glyphs", () => {
    expect(glyphFor(0)).toBe(" ");
    expect(glyphFor(0.39)).toBe(" ");
    expect(glyphFor(0.42)).toBe("·");
    expect(glyphFor(1)).toBe("▒");
    expect(glyphFor(1, ALT_GLYPHS)).toBe("▞");
    // Both ramps have the same number of steps, so a cell keeps its weight
    // when it mutates and only changes shape.
    expect([...ALT_GLYPHS]).toHaveLength([...GLYPHS].length);
  });

  it("mutates a minority of cells at any moment, and different ones over time", () => {
    const cells: Array<[number, number]> = [];
    for (let row = 0; row < 30; row += 1) for (let column = 0; column < 60; column += 1) cells.push([column, row]);
    const share = (time: number) => cells.filter(([column, row]) => mutates(column, row, time)).length / cells.length;
    expect(share(0)).toBeGreaterThan(0.05);
    expect(share(0)).toBeLessThan(0.4);
    const changed = cells.filter(([column, row]) => mutates(column, row, 0) !== mutates(column, row, 2)).length;
    expect(changed).toBeGreaterThan(cells.length * 0.1);
    const mutated = cells.find(([column, row]) => mutates(column, row, 0))!;
    expect([...ALT_GLYPHS]).toContain(glyphAt(1, mutated[0], mutated[1], 0));
    const plain = cells.find(([column, row]) => !mutates(column, row, 0))!;
    expect(glyphAt(1, plain[0], plain[1], 0)).toBe("▒");
  });

  it("lights up cells near the pointer and nothing beyond the halo", () => {
    expect(glowAt(0, 0)).toBe(1);
    expect(glowAt(75, 0)).toBeCloseTo(0.25, 5);
    expect(glowAt(150, 0)).toBe(0);
    expect(glowAt(400, 300)).toBe(0);
    expect(glowAt(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("renders a decorative canvas the server can emit without drawing", () => {
    const html = renderToStaticMarkup(createElement(AsciiClouds));
    expect(html).toBe('<canvas aria-hidden="true" class="hero-clouds"></canvas>');
    expect(renderToStaticMarkup(createElement(AsciiClouds, { className: "home-cta-clouds", color: "20 21 26" })))
      .toBe('<canvas aria-hidden="true" class="home-cta-clouds"></canvas>');
  });
});
