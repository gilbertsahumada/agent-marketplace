// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FunnelSection } from "../components/marketplace/funnel-section.tsx";
import type { FunnelSectionViewModel } from "../components/marketplace/presentation-types.ts";

afterEach(cleanup);

const funnel: FunnelSectionViewModel = {
  stages: [
    { label: "Registry entries indexed", detail: "Counted by full sweep.", count: "334,770", share: null, provenance: "observed" },
    { label: "ERC-8183 declared", detail: "Metadata claim.", count: "18", share: null, provenance: "declared" },
    { label: "Verified hireable now", detail: "Not published without a complete check.", count: null, share: null, provenance: null },
  ],
  citation: {
    artifact: "evidence/funnel-bsc-2026-09-04T19-31-44Z.json",
    sha256: "02f3282ed04bf35265b7e61aa2da1f24f32f857da4792b1c9d8ae1fcc5b8f58b",
    blockNumber: "119975081",
    generatedAt: "2026-09-04T19:31:44.602Z",
    scanDurationMs: 479353,
  },
};

describe("FunnelSection", () => {
  it("renders measured stages with counts and the artifact citation", () => {
    render(<FunnelSection funnel={funnel} />);
    expect(screen.getByText("334,770")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("119975081")).toBeInTheDocument();
    expect(screen.getByText(/02f3282ed0…fcc5b8f58b/)).toBeInTheDocument();
    expect(screen.getByText(/4 Sept 2026, 19:31 UTC/)).toBeInTheDocument();
  });

  it("marks unmeasured stages as pending instead of showing a zero", () => {
    render(<FunnelSection funnel={funnel} />);
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("keeps the ready-to-quote definition and escrow close without figures", () => {
    render(<FunnelSection funnel={null} />);
    const trigger = screen.getByRole("button", { name: "What “Ready to quote” means here" });
    fireEvent.click(trigger);
    expect(screen.getByText("What it does not mean")).toBeInTheDocument();
    expect(screen.getByText(/It sits in ERC-8183 escrow\./)).toBeInTheDocument();
    expect(screen.queryByText("119975081")).not.toBeInTheDocument();
  });
});
