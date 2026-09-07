import { expect, it, vi } from "vitest";
import { hireNotificationTick } from "../src/phases/hire-notification-tick";
import type { Env } from "../src/types";
it("preserves the manual-run pause even when notifications are enabled", async () => {
  const send = vi.fn();
  await hireNotificationTick({ HIRE_NOTIFICATION_RECOVERY_ENABLED:"1", STAGING_MANUAL_RUN:"1" } as Env, send);
  expect(send).not.toHaveBeenCalled();
});
it("uses the configured HTTPS origin without following redirects", async () => {
  const send = vi.fn(async () => new Response("{}"));
  await hireNotificationTick({ HIRE_NOTIFICATION_RECOVERY_ENABLED:"1", HIRE_NOTIFICATION_RUNNER_ORIGIN:"https://app.example", HIRE_NOTIFICATION_RUNNER_SECRET:"test" } as Env, send);
  expect(send).toHaveBeenCalledWith(new URL("https://app.example/api/internal/hire-notifications"), expect.objectContaining({ method:"POST", redirect:"error" }));
});
