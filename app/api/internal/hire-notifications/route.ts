import { timingSafeEqual } from "node:crypto";
import { notificationStore } from "@/src/mainnet/hire-notification-store";
import { processHireNotification } from "@/src/mainnet/hire-notification-recovery";

export const maxDuration = 180;
export async function POST(request: Request) {
  const secret = process.env.HIRE_NOTIFICATION_RUNNER_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  const candidate = Buffer.from(provided);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.HIRE_NOTIFICATION_RECOVERY_ENABLED !== "1") return Response.json({ error: "disabled" }, { status: 503 });
  try {
    const due = await notificationStore<Array<{ chainId: 56 | 97; jobId: string }>>({ action: "due" });
    const results = await Promise.allSettled(due.map(row => processHireNotification(row.chainId, row.jobId)));
    return Response.json({ checked: results.length, failed: results.filter(r => r.status === "rejected").length }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "recovery_unavailable" }, { status: 503 }); }
}
