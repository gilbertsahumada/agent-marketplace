// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobNotificationStatus } from "../components/marketplace/job-notification-status";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([['pending','Notification pending'],['uncertain','Checking agent response'],['attention','Notification needs attention'],['notified','Agent notified']])("shows the persisted %s state after opening the job", async (state, label) => {
  const fetchMock = vi.fn(async () => Response.json({state}));
  vi.stubGlobal("fetch", fetchMock);
  render(createElement(JobNotificationStatus, { chainId:97, jobId:"1066" }));
  expect(await screen.findByRole("status")).toHaveTextContent(label);
  expect(fetchMock).toHaveBeenCalledWith("/api/marketplace/jobs/testnet/1066/notification", expect.any(Object));
});
