import { hostedSellerMessageResponse } from "@/src/presentation/http/hosted-seller-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ seller: string }> }) {
  const { seller } = await context.params;
  return hostedSellerMessageResponse(seller, request);
}
