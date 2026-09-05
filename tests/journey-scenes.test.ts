import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DELIVERABLE_HASH, JOURNEY_SCENES, RECEIPT_HASH, SCENE_ROWS, discoverFrame, hireFrame, proveFrame, verifyFrame } from "@/components/marketplace/journey-scenes";
import { JourneySteps } from "@/components/marketplace/journey-steps";

describe("journey scenes", () => {
  it("always produce the same number of rows so the layout never shifts", () => {
    for (const { frame } of JOURNEY_SCENES) {
      for (const progress of [0, 0.1, 0.25, 0.5, 0.77, 0.9, 1]) expect(frame(progress)).toHaveLength(SCENE_ROWS);
    }
  });

  it("discover types the command, lists agents, then selects the match", () => {
    expect(discoverFrame(0.1)[0]).toMatch(/^ \$ agents.*_$/);
    expect(discoverFrame(0.1).slice(2, 5)).toEqual(["", "", ""]);
    expect(discoverFrame(0.5)[2]).toBe("   #303779  grid planner");
    expect(discoverFrame(1)[2]).toBe(" > #303779  grid planner    [x]");
    expect(discoverFrame(1)[6]).toBe(" 3 listed · selected #303779");
  });

  it("verify runs the four checks in order with a spinner until each reports", () => {
    const early = verifyFrame(0.3);
    expect(early[2]).toMatch(/^ identity {2}ERC-8004 #303779 {2}[|/\-\\]$/);
    expect(early[3]).toBe("");
    const done = verifyFrame(1);
    expect(done[2]).toBe(" identity  ERC-8004 #303779  ok");
    expect(done[5]).toBe(" escrow    ERC-8183 ready    ok");
    expect(done[7]).toBe(" 4/4 ran · nothing assumed");
  });

  it("hire creates then funds; the escrow box fills and locks", () => {
    expect(hireFrame(0.4)[2]).toMatch(/createJob\(\) {2}\[#+\.*\]/);
    expect(hireFrame(0.4)[3]).toBe("");
    expect(hireFrame(0.7)[6]).toMatch(/^ \|\$+ *\|$/);
    const done = hireFrame(1);
    expect(done[6]).toBe(" |$$$$$$$$$$$$$$$$|  LOCKED");
    expect(done[8]).toBe(" 0.01 USDT held in escrow");
  });

  it("prove resolves the deliverable and settlement hashes, then shows the receipt", () => {
    const noise = () => 0;
    expect(proveFrame(0.3, noise)[2]).toMatch(/^ submit\(\) {2}deliverable 0x[0-9a-f]{16}$/);
    expect(proveFrame(0.3, noise)[2]).not.toContain(DELIVERABLE_HASH);
    const done = proveFrame(1, noise);
    expect(done[2]).toBe(` submit()  deliverable 0x${DELIVERABLE_HASH}`);
    expect(done[3]).toBe(` settle()  tx 0x${RECEIPT_HASH.slice(0, 18)}`);
    expect(done[6]).toBe(" phase   SETTLED");
    expect(done.join("\n")).not.toMatch(/proven|track record|quality/i);
  });

  it("renders the four steps at rest on the server, scene below each step", () => {
    const html = renderToStaticMarkup(createElement(JourneySteps));
    expect(html.match(/market-scene/g)).toHaveLength(4);
    for (const step of ["Discover", "Verify", "Hire", "Prove"]) expect(html).toContain(step);
    expect(html.indexOf("Filter the market")).toBeLessThan(html.indexOf("$ agents --category"));
    expect(html).toContain("LOCKED");
    expect(html).not.toContain('data-active="true"');
  });
});
