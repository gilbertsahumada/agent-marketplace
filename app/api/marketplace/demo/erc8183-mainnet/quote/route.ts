import { NextResponse } from "next/server";
import { requestMainnetErc8183QuoteWithObservationSync } from "@/src/business/composition";
import { erc8183SpikeErrorResponse } from "@/src/presentation/http/erc8183-spike-http";

export async function POST() {
  try {
    return NextResponse.json(
      await requestMainnetErc8183QuoteWithObservationSync.execute(),
      { headers: { "cache-control": "no-store" } },
    );
  }
  catch (error) { return erc8183SpikeErrorResponse(error, "Mainnet"); }
}
