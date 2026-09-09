// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, it, expect } from "vitest";
import { PaginationLinks } from "../components/marketplace/page-primitives";

afterEach(cleanup);
it.each([
  [1, 120, 24, "Showing 24 of 120"],
  [5, 103, 7, "Showing 7 of 103"],
  [1, 0, 0, "Showing 0 of 0"],
  [1, 3, 3, "Showing 3 of 3"],
])("shows the loaded range for page %s and total %s", (page, total, shown, label) => {
  render(createElement(PaginationLinks, {page, total, shown, pageSize:24, totalPages:Math.ceil(total / 24), hrefFor:p => `/agents?page=${p}`}));
  expect(screen.getByRole("status")).toHaveTextContent(label);
});
