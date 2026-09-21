import { timingSafeEqual } from "node:crypto";
import { notificationStore } from "@/src/mainnet/hire-notification-store";
import { processHireNotification } from "@/src/mainnet/hire-notification-recovery";
import { catalogHireWritesEnabled } from "@/src/mainnet/catalog-hire-network";

export const maxDuration = 180;
export async function POST(request: Request) {
  const secret = process.env.HIRE_NOTIFICATION_RUNNER_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  const candidate = Buffer.from(provided);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.HIRE_NOTIFICATION_RECOVERY_ENABLED !== "1") return Response.json({ error: "disabled" }, { status: 503 });
  try {
    const chainIds = ([56, 97] as const).filter(chainId => catalogHireWritesEnabled(chainId));
    if (chainIds.length === 0) return Response.json({ checked: 0, failed: 0 }, { headers: { "cache-control": "no-store" } });
    // Internal authorization above creates this context; never copy a public
    // request header or body field into the private Worker budget marker.
    const due = await notificationStore<Array<{ chainId: 56 | 97; jobId: string }>>({ action: "due", chainIds }, {backgroundJobs:true});
    const results = await Promise.allSettled(due.map(row => processHireNotification(row.chainId, row.jobId, {backgroundJobs:true})));
    return Response.json({ checked: results.length, failed: results.filter(r => r.status === "rejected").length }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "recovery_unavailable" }, { status: 503 }); }
}
