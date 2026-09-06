import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRIEF, BRIEF_MS, LOOP_MS, RECEIPT_HASH, RESTING_ELAPSED, STEP_MS, STEP_TITLES, stageFrame } from "@/components/marketplace/hiring-stage-model";
import { HiringStage } from "@/components/marketplace/hiring-stage";

const still = () => 0;

describe("hiring stage", () => {
  it("types the brief field by field before any step starts", () => {
    const early = stageFrame(BRIEF_MS * 0.2, undefined, still);
    expect(early.brief.objective.endsWith("▌")).toBe(true);
    expect(early.brief.deliverable).toBe("");
    expect(early.briefDone).toBe(false);
    expect(early.steps.every((step) => step.state === "pending")).toBe(true);
    expect(early.rail).toBe(0);
    const written = stageFrame(BRIEF_MS, undefined, still);
    expect(written.brief).toEqual(BRIEF);
    expect(written.briefDone).toBe(true);
  });

  it("runs the four steps one at a time and fills the rail", () => {
    const second = stageFrame(BRIEF_MS + STEP_MS * 1.5, { name: "Grid Planner", agentId: "303779" }, still);
    expect(second.steps.map((step) => step.state)).toEqual(["done", "active", "pending", "pending"]);
    expect(second.steps[0]!.lines[0]).toBe("> Grid Planner #303779");
    expect(second.steps[1]!.lines[0]).toMatch(/^identity ok · endpoint 200/);
    expect(second.steps[2]!.lines).toEqual(["", ""]);
    expect(second.rail).toBeCloseTo(1.5 / 4, 5);
  });

  it("rests with the brief written, every step done and the receipt resolved", () => {
    const rest = stageFrame(RESTING_ELAPSED, undefined, still);
    expect(rest.steps.every((step) => step.state === "done")).toBe(true);
    expect(rest.rail).toBe(1);
    expect(rest.steps[2]!.lines[0]).toContain("LOCKED");
    expect(rest.steps[3]!.lines[0]).toBe(`settle() tx 0x${RECEIPT_HASH.slice(0, 16)}…`);
    expect(rest.steps[3]!.lines[1]).toBe("block 120,177,601 · SETTLED");
    expect(rest.steps.map((step) => step.title)).toEqual([...STEP_TITLES]);
  });

  it("loops: past the hold it starts writing the brief again", () => {
    const again = stageFrame(LOOP_MS + 100, undefined, still);
    expect(again.briefDone).toBe(false);
    expect(again.steps.every((step) => step.state === "pending")).toBe(true);
  });

  it("renders the finished scene on the server with the real agent's quote link", () => {
    const html = renderToStaticMarkup(createElement(HiringStage, { agent: { name: "Grid Planner", agentId: "303779", href: "/hire/303779", quoteCapable: true } }));
    expect(html).toContain(BRIEF.objective);
    expect(html).toContain("Grid Planner #303779");
    expect(html.match(/data-state="done"/g)).toHaveLength(4);
    expect(html).toContain("Get a quote from Grid Planner");
    expect(html).toContain('href="/hire/303779"');
    expect(html).not.toMatch(/proven|track record|applied/i);
    const listed = renderToStaticMarkup(createElement(HiringStage, { agent: { name: "Grid Bot", agentId: "7", href: "/hire/7", quoteCapable: false } }));
    expect(listed).toContain("See Grid Bot");
    expect(renderToStaticMarkup(createElement(HiringStage))).not.toContain("Get a quote");
  });
});
