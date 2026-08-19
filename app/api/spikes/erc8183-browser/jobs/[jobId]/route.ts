import { NextResponse } from "next/server";
import { getErc8183JobStatus } from "@/src/business/composition";
import {
  erc8183SpikeErrorResponse,
  spikeJobId,
} from "@/src/presentation/http/erc8183-spike-http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    return NextResponse.json(await getErc8183JobStatus.execute({ jobId: spikeJobId(jobId) }));
  } catch (error) {
    return erc8183SpikeErrorResponse(error);
  }
}
