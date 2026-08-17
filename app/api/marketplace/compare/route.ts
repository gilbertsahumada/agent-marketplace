import { NextResponse } from "next/server";
import { compareMarketplaceAgents } from "@/src/business/composition";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET(request: Request) {
  try {
    const agentIds = new URL(request.url).searchParams.getAll("agentId");
    return NextResponse.json(await compareMarketplaceAgents.execute({ agentIds }));
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
