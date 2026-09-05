import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JOURNEY_SCENES, RECEIPT_HASH, SCENE_ROWS, discoverFrame, hireFrame, proveFrame, verifyFrame } from "@/components/marketplace/journey-scenes";
import { JourneySteps } from "@/components/marketplace/journey-steps";

describe("journey scenes", () => {
  it("always produce the same number of rows so the layout never shifts", () => {
    for (const { frame } of JOURNEY_SCENES) {
      for (const progress of [0, 0.25, 0.5, 0.77, 0.9, 1]) expect(frame(progress)).toHaveLength(SCENE_ROWS);
    }
  });

  it("discover sweeps the grid, then marks the found agent", () => {
    expect(discoverFrame(0).join("\n")).toContain("+");
    expect(discoverFrame(0).join("\n")).not.toContain("[#]");
    expect(discoverFrame(1).join("\n")).toContain("[#]");
    expect(discoverFrame(1)[6]).toBe(" found · grid planner");
  });

  it("verify fills the four checks in order and reports how many ran", () => {
    const half = verifyFrame(0.5);
    expect(half[1]).toBe(" identity [########] ok");
    expect(half[2]).toBe(" endpoint [########] ok");
    expect(half[4]).toBe(" escrow   [........]");
    expect(verifyFrame(1)[6]).toBe(" 4/4 checks ran");
  });

  it("hire fills the escrow box from the bottom and locks it at the end", () => {
    expect(hireFrame(0.3)[4]).toContain("$");
    expect(hireFrame(0.3)[1]).not.toContain("$");
    expect(hireFrame(1)[0]).toContain("LOCKED");
    expect(hireFrame(1)[7]).toBe(" 0.01 USDT held in escrow");
  });

  it("prove resolves the receipt hash left to right and never claims quality", () => {
    const noise = () => 0;
    const early = proveFrame(0.25, noise).slice(1, 3).join("").replace(/\s|tx 0x/g, "");
    expect(early.startsWith(RECEIPT_HASH.slice(0, 6))).toBe(true);
    expect(early).not.toBe(RECEIPT_HASH);
    const done = proveFrame(1, noise);
    expect(done.slice(1, 3).join("").replace(/\s|tx 0x/g, "")).toBe(RECEIPT_HASH);
    expect(done.join("\n")).not.toMatch(/proven|track record|quality/i);
  });

  it("renders the four steps at rest on the server", () => {
    const html = renderToStaticMarkup(createElement(JourneySteps));
    expect(html.match(/market-scene/g)).toHaveLength(4);
    for (const step of ["Discover", "Verify", "Hire", "Prove"]) expect(html).toContain(step);
    expect(html).toContain("[#]");
    expect(html).toContain("LOCKED");
    expect(html).not.toContain('data-active="true"');
  });
});
