import { hostedSellerDeliverableResponse } from "@/src/presentation/http/hosted-seller-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ seller: string; jobId: string }> }) {
  const { seller, jobId } = await context.params;
  return hostedSellerDeliverableResponse(seller, jobId);
}
