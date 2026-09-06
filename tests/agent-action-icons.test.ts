import { expect, it } from "vitest";
import { BriefcaseBusiness, FilePlus2, RefreshCw, SearchCheck } from "lucide-react";
import { agentActionIcon } from "../components/marketplace/agent-card";

it.each([
  ["Request quote", FilePlus2],
  ["Retry quote", RefreshCw],
  ["Retry availability", RefreshCw],
  ["Hire agent", BriefcaseBusiness],
  ["Check compatibility", SearchCheck],
  ["Check availability", SearchCheck],
] as const)("maps %s to its action-specific icon", (label, icon) => {
  expect(agentActionIcon(label)).toBe(icon);
});
