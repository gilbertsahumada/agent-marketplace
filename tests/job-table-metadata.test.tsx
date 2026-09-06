// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopyJobId, JobTimestamp } from "../components/marketplace/job-table-metadata";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("copies only the numeric job ID and acknowledges success", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<CopyJobId jobId="56717" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy job ID 56717" }));
  expect(await screen.findByText("Job ID copied")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("56717");
});
it("updates relative time and switches from clock to calendar at one day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:30Z"));
  const { container, rerender } = render(<JobTimestamp value="2026-09-06T12:00:00Z" />);
  expect(screen.getByText("30s ago")).toBeInTheDocument();
  expect(container.querySelector(".lucide-clock-3")).not.toBeNull();
  expect(screen.getByText("2026-09-06 12:00:00 UTC")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByText("1m ago")).toBeInTheDocument();
  rerender(<JobTimestamp value="2026-09-05T12:00:00Z" />);
  expect(screen.getByText("1d ago")).toBeInTheDocument();
  expect(container.querySelector(".lucide-calendar-days")).not.toBeNull();
});
it("does not invent a missing registration timestamp", () => {
  const { container } = render(<JobTimestamp value={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(container.querySelector("time")).toBeNull();
});
