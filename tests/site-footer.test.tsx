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
});

it("stays out of the concierge, which is a full-height chat", () => {
  pathname.current = "/ask";
  render(<SiteFooter />);
  expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
});
