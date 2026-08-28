import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");

describe("Free runtime module loading", () => {
  it("loads health and scheduled code only for their handlers", () => {
    const source = readFileSync(resolve(projectRoot, "src/index.ts"), "utf8");

    expect(source).not.toMatch(/import \{ healthResponse \} from/);
    expect(source).not.toMatch(/import \{ runWp2Scheduled \} from/);
    expect(source).toContain('await import("./routes/health")');
    expect(source).toContain('await import("./scheduled")');
  });

  it("does not evaluate both phase implementations for one scheduled phase", () => {
    const source = readFileSync(resolve(projectRoot, "src/scheduled.ts"), "utf8");

    expect(source).not.toMatch(/import \{[\s\S]*?runHeader[\s\S]*?\} from "\.\/phases\/header"/);
    expect(source).not.toMatch(/import \{[\s\S]*?runSweepPhase[\s\S]*?\} from "\.\/phases\/sweep"/);
    expect(source).toContain('await import("./phases/header")');
    expect(source).toContain('await import("./phases/sweep")');
  });
});
