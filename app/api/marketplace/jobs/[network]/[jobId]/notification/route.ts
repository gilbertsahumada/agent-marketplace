import { notificationStore } from "@/src/mainnet/hire-notification-store";
import type { HireNotification } from "@/shared/hire-notification";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ network: string; jobId: string }> }) {
  const { network, jobId } = await context.params;
  const headers = { "cache-control": "no-store" };
  if (!["mainnet","testnet"].includes(network) || !/^[1-9]\d{0,19}$/.test(jobId)) return Response.json({ error: "invalid_request" }, { status: 400, headers });
  if (process.env.HIRE_NOTIFICATION_RECOVERY_ENABLED !== "1") return Response.json({ state: null }, { headers });
  try {
    const row = await notificationStore<HireNotification | null>({ action: "read", chainId: network === "testnet" ? 97 : 56, jobId });
    return Response.json({ state: row?.state ?? null, updatedAt: row?.updatedAt ?? null }, { headers });
  } catch { return Response.json({ error: "unavailable" }, { status: 503, headers }); }
}
