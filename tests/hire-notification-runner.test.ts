import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/data/observation/hire-notification-store", () => ({ notificationStore: vi.fn(async () => []) }));
vi.mock("../src/mainnet/hire-notification-recovery", () => ({ processHireNotification: vi.fn() }));
import { POST } from "../app/api/internal/hire-notifications/route";
import { notificationStore } from "../src/data/observation/hire-notification-store";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("filters disabled chains before the Worker limits the batch", async () => {
  vi.stubEnv("HIRE_NOTIFICATION_RUNNER_SECRET", "abc");
  vi.stubEnv("HIRE_NOTIFICATION_RECOVERY_ENABLED", "1");
  vi.stubEnv("ERC8183_TESTNET_HIRE_ENABLED", "true");
  vi.stubEnv("ERC8183_MAINNET_WRITES_ENABLED", "false");
  await POST(new Request("https://app.test/api/internal/hire-notifications", { method: "POST", headers: { authorization: "Bearer abc" } }));
  expect(notificationStore).toHaveBeenCalledWith({ action: "due", chainIds: [97] });
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
