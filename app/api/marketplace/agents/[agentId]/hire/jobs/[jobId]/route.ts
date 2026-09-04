import { NextResponse } from "next/server";
import { CatalogErc8183Repository } from "@/src/mainnet/catalog-erc8183-repository";
import { CatalogHireUnavailableError, resolveCatalogHireTarget } from "@/src/mainnet/catalog-hire";
import { erc8183SpikeErrorResponse } from "@/src/presentation/http/erc8183-spike-http";

function response(error: unknown): NextResponse {
  if (error instanceof CatalogHireUnavailableError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 409 });
  }
  return erc8183SpikeErrorResponse(error, "Mainnet");
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string; jobId: string }> }) {
  try {
    const { agentId, jobId } = await context.params;
    const quoteRequestId = Number(new URL(request.url).searchParams.get("quoteRequestId"));
    if (!Number.isSafeInteger(quoteRequestId) || quoteRequestId < 1 || !/^\d+$/.test(jobId) || jobId === "0") {
      return NextResponse.json({ error: { code: "INVALID_ERC8183_SPIKE_INPUT", message: "jobId and quoteRequestId are required" } }, { status: 400 });
    }
    const target = await resolveCatalogHireTarget(agentId, quoteRequestId, { allowExpired: true });
    const job = await (new CatalogErc8183Repository(target)).getJob(BigInt(jobId));
    return NextResponse.json({ job }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return response(error); }
}
