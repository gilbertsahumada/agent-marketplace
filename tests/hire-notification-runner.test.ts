import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/data/observation/hire-notification-store", () => ({ notificationStore: vi.fn(async () => []) }));
vi.mock("../src/mainnet/hire-notification-recovery", () => ({ processHireNotification: vi.fn() }));
import { POST } from "../app/api/internal/hire-notifications/route";
import { notificationStore } from "../src/data/observation/hire-notification-store";
import { processHireNotification } from "../src/mainnet/hire-notification-recovery";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("filters disabled chains before the Worker limits the batch", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RUNNER_SECRET", "abc");
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", "1");
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED", "true");
  vi.stubEnv("ERC8183_MAINNET_WRITES_ENABLED", "false");
  await POST(new Request("https://app.test/api/internal/hire-notifications", { method: "POST", headers: { authorization: "Bearer abc" } }));
  expect(notificationStore).toHaveBeenCalledWith({ action: "due", chainIds: [97] }, {backgroundJobs:true});
});
it("rejects absent, incorrect and multibyte credentials before reading jobs", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RUNNER_SECRET", "abc");
  for (const authorization of ["", "Bearer xyz", "Bearer ééé"]) {
    expect((await POST(new Request("https://app.test/api/internal/hire-notifications", { method: "POST", headers: { authorization } }))).status).toBe(401);
  }
  expect(notificationStore).not.toHaveBeenCalled();
});
it("requires the activation flag even with valid credentials", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RUNNER_SECRET", "abc");
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", "0");
  expect((await POST(new Request("https://app.test/api/internal/hire-notifications", { method: "POST", headers: { authorization: "Bearer abc" } }))).status).toBe(503);
  expect(notificationStore).not.toHaveBeenCalled();
});
it("creates trusted background context only after authenticating the runner", async()=>{
  vi.stubEnv("HIRE_NOTIFICATION_RUNNER_SECRET","abc");
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED","1");
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED","true");
  vi.mocked(notificationStore).mockResolvedValueOnce([{chainId:97,jobId:"1"}]);
  const unauthorized=await POST(new Request("https://app.test/api/internal/hire-notifications",{method:"POST",headers:{"x-marketplace-background-jobs":"1"}}));
  expect(unauthorized.status).toBe(401);
  expect(notificationStore).not.toHaveBeenCalled();
  await POST(new Request("https://app.test/api/internal/hire-notifications",{method:"POST",headers:{authorization:"Bearer abc"}}));
  expect(processHireNotification).toHaveBeenCalledWith(97,"1",{backgroundJobs:true});
});
