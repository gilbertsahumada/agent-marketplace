import { getHireLedger } from "@/src/business/composition";
import { readJobDelivery } from "@/src/mainnet/read-job-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const headers = { "cache-control": "no-store" };
  if (!/^[1-9]\d{0,19}$/.test(jobId)) return Response.json({ error: "Invalid job ID" }, { status: 400, headers });
  try {
    const ledger = await getHireLedger.getJob({ chainId: 56, jobId });
    if (!ledger) return Response.json({ error: "Job not indexed" }, { status: 404, headers });
    return Response.json(await readJobDelivery(ledger), { headers });
  } catch {
    return Response.json({ error: "Delivery verification is temporarily unavailable" }, { status: 503, headers });
  }
}
