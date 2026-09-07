import "server-only";
import { privateWorkerUrl } from "./catalog-observation-sync.ts";

export async function notificationStore<T>(body: Record<string, unknown>): Promise<T> {
  const url = privateWorkerUrl(process.env, "/hire-notifications");
  const secret = process.env.BUYER_OBSERVATION_SECRET?.trim();
  if (!url || !secret) throw new Error("Notification recovery is not configured");
  const response = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Notification recovery is unavailable");
  return await response.json() as T;
}
