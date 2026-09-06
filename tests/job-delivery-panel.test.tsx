// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobDeliveryPanel } from "../components/marketplace/job-delivery-panel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const report = { jobId: "56719", status: "SUBMITTED", checkedAt: "2026-09-06T14:00:00Z", closure: "review_window", reviewEndsAt: "2026-09-13T13:44:37Z", policy: null,
  delivery: { status: "unsupported", content: "<script>alert(1)</script>", url: "https://seller.example/result" } };
it("highlights only exact request values, including regex characters, without interpreting HTML", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...report, requestTexts: ["testing (a+b)", "<b>all done</b>"], delivery: { ...report.delivery, content: 'Task "testing (a+b)" met "<b>all done</b>". Seller says "complete".' } })));
  const { container } = render(<JobDeliveryPanel jobId="56719" />);
  await screen.findByText("Unverified format");
  expect([...container.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(["testing (a+b)", "<b>all done</b>"]);
  expect(container.querySelector("pre b")).toBeNull();
  expect(container.querySelector("mark")).toHaveClass("bg-signal", "text-black");
});
it("renders seller text without HTML execution or a quality claim", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(report)));
  const { container } = render(<JobDeliveryPanel jobId="56719" />);
  await screen.findByText("Unverified format");
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.queryByText("Integrity verified")).not.toBeInTheDocument();
  expect(screen.getByText("Review window open")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Seller source" })).toHaveAttribute("rel", "noopener noreferrer");
});
it("stops loading on failure and offers a read-only retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(report));
  vi.stubGlobal("fetch", fetcher);
  render(<JobDeliveryPanel jobId="56719" />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Checking delivery…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await screen.findByText("Unverified format");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
});
