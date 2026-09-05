import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AsciiClouds, cloudDensity, glyphFor } from "@/components/marketplace/ascii-clouds";

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
  });

  it("maps low density to empty cells and higher density to denser glyphs", () => {
    expect(glyphFor(0)).toBe(" ");
    expect(glyphFor(0.39)).toBe(" ");
    expect(glyphFor(0.42)).toBe("·");
    expect(glyphFor(1)).toBe("*");
  });

  it("renders a decorative canvas the server can emit without drawing", () => {
    const html = renderToStaticMarkup(createElement(AsciiClouds));
    expect(html).toBe('<canvas aria-hidden="true" class="hero-clouds"></canvas>');
  });
});
