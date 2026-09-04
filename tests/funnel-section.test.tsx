// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FunnelSection } from "../components/marketplace/funnel-section.tsx";
import type { FunnelSectionViewModel } from "../components/marketplace/presentation-types.ts";

afterEach(cleanup);

const funnel: FunnelSectionViewModel = {
  stages: [
    { label: "Registered on BSC", detail: "Counted by full sweep.", count: "309,897", share: null, provenance: "observed" },
    { label: "Declares ERC-8183 hiring", detail: "Escrow transport.", count: "16", share: null, provenance: "declared" },
    { label: "Answers with a verified quote", detail: "Measured live soon.", count: null, share: null, provenance: null },
  ],
  citation: {
    artifact: "evidence/funnel-bsc-2026-08-27T19-41-17Z.json",
    sha256: "a8149173eeb70fb19a38610e98e4e11ecbce7ccadcfc2c0e6e25fa14a075fe69",
    blockNumber: "118441354",
    generatedAt: "2026-08-27T19:41:17.543Z",
  },
};

describe("FunnelSection", () => {
  it("renders measured stages with counts and the artifact citation", () => {
    render(<FunnelSection funnel={funnel} />);
    expect(screen.getByText("309,897")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText(/block 118441354/)).toBeInTheDocument();
    expect(screen.getByText(/a8149173…a075fe69/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-27T19:41:17\.543Z/)).toBeInTheDocument();
  });

  it("marks unmeasured stages as pending instead of showing a zero", () => {
    render(<FunnelSection funnel={funnel} />);
    expect(screen.getByText("Pending observation")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("keeps the ready-to-quote definition and escrow close without figures", () => {
    render(<FunnelSection funnel={null} />);
    const trigger = screen.getByRole("button", { name: "What “Ready to quote” means here" });
    fireEvent.click(trigger);
    expect(screen.getByText("What it does not mean")).toBeInTheDocument();
    expect(screen.getByText(/It sits in ERC-8183 escrow\./)).toBeInTheDocument();
    expect(screen.queryByText(/block 118441354/)).not.toBeInTheDocument();
  });
});
