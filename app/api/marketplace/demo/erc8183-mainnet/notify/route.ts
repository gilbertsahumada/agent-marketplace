import { NextResponse } from "next/server";
import { notifyMainnetFundedJob } from "@/src/business/composition";
import { erc8183SpikeErrorResponse, spikeAddress, spikeJobId, spikeJsonBody } from "@/src/presentation/http/erc8183-spike-http";

export async function POST(request: Request) {
  try {
    const body = await spikeJsonBody(request);
    return NextResponse.json(await notifyMainnetFundedJob.execute({
      buyer: spikeAddress(body.buyer, "buyer"),
      jobId: spikeJobId(body.jobId),
    }));
  } catch (error) { return erc8183SpikeErrorResponse(error, "Mainnet"); }
}
