import { readTestnetClosure } from "@/src/business/testnet-closure";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const headers = { "Cache-Control": "no-store" };
  if (!/^[1-9]\d{0,19}$/.test(jobId)) return Response.json({ error: "Invalid job ID" }, { status: 400, headers });
  try { return Response.json(await readTestnetClosure(jobId), { headers }); }
  catch { return Response.json({ error: "Testnet closure state is unavailable or unsupported. No transaction was sent." }, { status: 503, headers }); }
}
