// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, it, expect } from "vitest";
import { ServiceCompare } from "../components/marketplace/service-compare";
import { paginationSummary } from "../components/marketplace/pagination-summary";
import type { AgentCardViewModel } from "../components/marketplace/presentation-types";
afterEach(cleanup);
const agent: AgentCardViewModel = {agentId:"2197", chainId:97, name:"Grid", description:"Grid planning", operator:"marketplace", categories:["grid_trading"], href:"/hire/2197?network=testnet", hireability:"listed_only", passportState:"registered", evidence:[]};
const candidates = [agent, {...agent,agentId:"2198"}, {...agent,agentId:"2199"}, {...agent,agentId:"2200"}];
it("caps selection at three and preserves IDs in pagination", async () => {
  render(createElement(ServiceCompare,{network:"testnet",q:"grid",page:1,total:40,candidates,agents:[],selected:[],unavailable:[]}));
  expect(screen.getByRole("button",{name:/Compare selected/})).toBeDisabled();
  const boxes = screen.getAllByRole("checkbox");
  for (const box of boxes.slice(0,3)) await userEvent.click(box);
  expect(boxes[3]).toBeDisabled();
  expect(screen.getByRole("link",{name:"Next"})).toHaveAttribute("href","/compare?network=testnet&q=grid&page=2&agentId=2197&agentId=2198&agentId=2199");
  await userEvent.click(screen.getByRole("button",{name:"Clear selection"}));
  expect(boxes[3]).not.toBeDisabled();
});
it("preserves network and never invents missing history or a job price", () => {
  render(createElement(ServiceCompare,{network:"testnet",q:"",page:1,total:4,candidates,agents:[agent],selected:["2197"],unavailable:["9999"]}));
  expect(screen.getByRole("link",{name:"Explore service"})).toHaveAttribute("href","/hire/2197?network=testnet");
  expect(screen.getAllByText("Not recorded")).toHaveLength(2);
  expect(screen.getByText("After your own quotation")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("#9999");
});
it("distinguishes unavailable totals from zero", () => {
  expect(paginationSummary(24)).toBe("Showing 24 · Total unavailable");
  expect(paginationSummary(0,0)).toBe("Showing 0 of 0");
});
