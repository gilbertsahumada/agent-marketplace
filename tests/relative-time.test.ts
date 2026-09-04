import { describe, expect, it } from "vitest";
import { relativeAge } from "@/components/marketplace/relative-time";

describe("relativeAge", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");

  it.each([
    ["2026-09-04T11:59:58.000Z", "now"],
    ["2026-09-04T11:59:30.000Z", "30s ago"],
    ["2026-09-04T11:55:00.000Z", "5m ago"],
    ["2026-09-04T09:00:00.000Z", "3h ago"],
    ["2026-09-02T12:00:00.000Z", "2d ago"],
  ])("formats %s as %s", (value, expected) => {
    expect(relativeAge(value, now)).toBe(expected);
  });

  it("does not expose invalid dates as NaN", () => {
    expect(relativeAge("invalid", now)).toBe("now");
  });
});
