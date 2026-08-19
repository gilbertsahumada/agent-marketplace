import { NextResponse } from "next/server";
import { prepareErc8183Hire } from "@/src/business/composition";
import { erc8183SpikeErrorResponse, spikeAddress, spikeJsonBody, spikeQuote } from "@/src/presentation/http/erc8183-spike-http";

export async function POST(request: Request) {
  try {
    const body = await spikeJsonBody(request);
    return NextResponse.json(await prepareErc8183Hire.execute({
      buyer: spikeAddress(body.buyer, "buyer"),
      quote: spikeQuote(body.quote),
    }));
  } catch (error) {
    return erc8183SpikeErrorResponse(error);
  }
}
