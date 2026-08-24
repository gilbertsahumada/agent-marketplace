import { getMainnetGridSellerDeliverable } from "@/src/mainnet/grid-seller-composition";
import { hostedSellerErrorResponse } from "@/src/presentation/http/hosted-seller-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    return Response.json(await getMainnetGridSellerDeliverable.execute({ jobId }));
  } catch (error) {
    console.error("[mainnet-grid-seller] Deliverable request failed");
    return hostedSellerErrorResponse(error, null, "Mainnet Grid seller");
  }
}
