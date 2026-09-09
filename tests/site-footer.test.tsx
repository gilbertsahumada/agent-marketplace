// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiteFooter } from "../components/marketplace/site-footer";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

it("renders the footer on ordinary pages", () => {
  pathname.current = "/agents";
  render(<SiteFooter />);
  expect(screen.getByRole("navigation", { name: "Footer marketplace" })).toBeInTheDocument();
  expect(screen.getByText("Workmint")).toBeInTheDocument();
  expect(screen.getByText("Hire agents. Get work done.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Workmint on GitHub" })).toBeInTheDocument();
});

it("closes with a decorative wordmark that assistive tech skips", () => {
  pathname.current = "/agents";
  const { container } = render(<SiteFooter />);
  const wordmark = container.querySelector(".site-wordmark");
  expect(wordmark).toHaveTextContent("WORKMINT");
  expect(wordmark).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByText("WORKMINT")).not.toBeNull();
});

it("stays out of the concierge, which is a full-height chat", () => {
  pathname.current = "/ask";
  render(<SiteFooter />);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
});
