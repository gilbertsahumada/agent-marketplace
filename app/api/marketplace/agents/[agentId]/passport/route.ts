import { NextResponse } from "next/server";
import { getAgentEvidencePassport } from "@/src/business/composition";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await context.params;
    const passport = await getAgentEvidencePassport.execute({ agentId });
    return NextResponse.json(passport, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
