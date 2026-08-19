import { NextResponse } from "next/server";
import { requestErc8183Quote } from "@/src/business/composition";
import { erc8183SpikeErrorResponse } from "@/src/presentation/http/erc8183-spike-http";

export async function POST() {
  try {
    return NextResponse.json(await requestErc8183Quote.execute());
  } catch (error) {
    return erc8183SpikeErrorResponse(error);
  }
}
