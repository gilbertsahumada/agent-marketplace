import { NextResponse } from "next/server";
import { getHostedSellerDeliverable } from "@/src/business/hosted-seller-composition";
import { hostedSellerErrorResponse } from "@/src/presentation/http/hosted-seller-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    return NextResponse.json(
      await getHostedSellerDeliverable.execute({ jobId }),
    );
  } catch (error) {
    console.error("[hosted-seller] Deliverable request failed");
    return hostedSellerErrorResponse(error);
  }
}
