import { NextResponse } from "next/server";
import { getMarketplaceAgent } from "@/src/business/composition";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    return NextResponse.json(await getMarketplaceAgent.execute({ agentId }));
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
