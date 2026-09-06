// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MessageResponse } from "../components/ai-elements/message";

afterEach(cleanup);

// Catalog text written by sellers reaches the model and can come back in
// its reply as markdown. The reply must not load remote resources or hand
// out external links dressed as the concierge's own words.
it("renders no remote images and keeps only same-site links from the model reply", () => {
  const { container } = render(
    <MessageResponse mode="static">
      {'Grid Planner ![p](https://evil.example/p.png) <img src="https://evil.example/raw.png"> [support](https://evil.example/login) and [the agent](/hire/303779).'}
    </MessageResponse>,
  );

  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('link[rel="preload"]')).toBeNull();
  const links = [...container.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
  expect(links).toEqual(["/hire/303779"]);
  expect(container.textContent).toContain("support");
});
