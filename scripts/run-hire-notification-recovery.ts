/** One authenticated recovery tick; never creates, funds or signs a job. */
const origin = process.env.HIRE_NOTIFICATION_RUNNER_ORIGIN;
const secret = process.env.HIRE_NOTIFICATION_RUNNER_SECRET;
if (!origin || !secret) throw new Error("Configure HIRE_NOTIFICATION_RUNNER_ORIGIN and HIRE_NOTIFICATION_RUNNER_SECRET");
const url = new URL(origin);
if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)))) throw new Error("Invalid runner origin");
const response = await fetch(new URL("/api/internal/hire-notifications", url), {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(180000), headers: { authorization: `Bearer ${secret}` },
});
if (!response.ok) throw new Error(`Recovery tick failed (${response.status})`);
console.log(await response.json());
export {};
