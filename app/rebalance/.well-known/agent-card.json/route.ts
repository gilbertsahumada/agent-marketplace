import { hostedSellerCardResponse } from "@/src/presentation/http/hosted-seller-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return hostedSellerCardResponse("rebalance");
}
