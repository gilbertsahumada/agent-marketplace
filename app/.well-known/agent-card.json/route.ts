import { NextResponse } from "next/server";
import { getHostedSellerAgentCard } from "@/src/business/hosted-seller-composition";
import { hostedSellerErrorResponse } from "@/src/presentation/http/hosted-seller-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getHostedSellerAgentCard.execute());
  } catch (error) {
    console.error("[hosted-seller] Agent Card request failed");
    return hostedSellerErrorResponse(error);
  }
}
