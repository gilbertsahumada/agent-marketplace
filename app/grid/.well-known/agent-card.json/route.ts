import { NextResponse } from "next/server";
import { getMainnetGridSellerAgentCard } from "@/src/mainnet/grid-seller-composition";
import { hostedSellerErrorResponse } from "@/src/presentation/http/hosted-seller-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMainnetGridSellerAgentCard.execute());
  } catch (error) {
    console.error("[mainnet-grid-seller] Agent Card request failed");
    return hostedSellerErrorResponse(error, null, "Mainnet Grid seller");
  }
}
