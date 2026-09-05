// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteDetails } from "../components/marketplace/quote-details";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const hash = `0x${"ab".repeat(32)}`;
it("keeps technical details collapsed and copies the complete off-chain hash", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<QuoteDetails requestHash={hash} />);
  const details = screen.getByText("Quote details").closest("details")!;
  expect(details).not.toHaveAttribute("open");
  details.open = true;
  expect(screen.getByTitle(hash)).toHaveTextContent("…");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy request hash" }));
  await screen.findByText("Copied");
  expect(writeText).toHaveBeenCalledWith(hash);
});
it("exposes the full hash for manual copying when clipboard access fails", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  render(<QuoteDetails requestHash={hash} />);
  screen.getByText("Quote details").closest("details")!.open = true;
  fireEvent.click(screen.getByRole("button", { name: "Copy request hash" }));
  await screen.findByText(/Could not copy/);
  expect(screen.getByText(hash)).toBeInTheDocument();
});
