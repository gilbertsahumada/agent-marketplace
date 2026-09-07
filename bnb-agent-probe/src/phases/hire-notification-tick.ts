import type { Env } from "../types";

export async function hireNotificationTick(env: Env, fetchImpl: typeof fetch = fetch) {
  if (env.HIRE_NOTIFICATION_RECOVERY_ENABLED !== "1" || env.STAGING_MANUAL_RUN === "1") return;
  if (!env.HIRE_NOTIFICATION_RUNNER_ORIGIN || !env.HIRE_NOTIFICATION_RUNNER_SECRET) throw new Error("Notification runner is not configured");
  const origin = new URL(env.HIRE_NOTIFICATION_RUNNER_ORIGIN);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid notification runner origin");
  const response = await fetchImpl(new URL("/api/internal/hire-notifications", origin), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(110000),
    headers: { authorization: `Bearer ${env.HIRE_NOTIFICATION_RUNNER_SECRET}` },
  });
  if (!response.ok) throw new Error("Notification runner unavailable");
}
