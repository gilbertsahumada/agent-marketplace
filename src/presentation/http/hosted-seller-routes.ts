import { NextResponse } from "next/server";
import { isHostedSellerSlug } from "../../business/policies/hosted-seller-catalog.ts";
import { hostedSellerUseCases } from "../../mainnet/hosted-seller-composition.ts";
import { hostedSellerErrorResponse, hostedSellerRpcResult, parseHostedSellerRequest } from "./hosted-seller-http.ts";

// Thin controllers shared by every marketplace-operated seller route. The
// Grid seller keeps its own static routes; an unknown or "grid" slug on the
// dynamic route is a 404 so there is exactly one URL per seller.
function unknownSeller(): NextResponse {
  return NextResponse.json({ error: { code: "UNKNOWN_SELLER", message: "No marketplace-operated seller at this path" } }, { status: 404 });
}

function knownSlug(seller: string) {
  return isHostedSellerSlug(seller) && seller !== "grid" ? seller : null;
}

export async function hostedSellerCardResponse(seller: string): Promise<Response> {
  const slug = knownSlug(seller);
  if (!slug) return unknownSeller();
  try {
    return NextResponse.json(await hostedSellerUseCases(slug).getAgentCard.execute());
  } catch (error) {
    console.error(`[mainnet-${slug}-seller] Agent Card request failed`);
    return hostedSellerErrorResponse(error, null, `Mainnet ${slug} seller`);
  }
}

export async function hostedSellerMessageResponse(seller: string, request: Request): Promise<Response> {
  const slug = knownSlug(seller);
  if (!slug) return unknownSeller();
  let id: unknown = null;
  try {
    const parsed = await parseHostedSellerRequest(request);
    id = parsed.id;
    return hostedSellerRpcResult(id, await hostedSellerUseCases(slug).handleMessage.execute(parsed.message));
  } catch (error) {
    console.error(`[mainnet-${slug}-seller] A2A request failed`);
    return hostedSellerErrorResponse(error, id, `Mainnet ${slug} seller`);
  }
}

export async function hostedSellerDeliverableResponse(seller: string, jobId: string): Promise<Response> {
  const slug = knownSlug(seller);
  if (!slug) return unknownSeller();
  try {
    return Response.json(await hostedSellerUseCases(slug).getDeliverable.execute({ jobId }));
  } catch (error) {
    console.error(`[mainnet-${slug}-seller] Deliverable request failed`);
    return hostedSellerErrorResponse(error, null, `Mainnet ${slug} seller`);
  }
}
