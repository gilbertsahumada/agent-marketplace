import { NextResponse } from "next/server";
import { getBuyerNegotiationInput } from "@/src/business/composition";
import { callerContext, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    if (!/^[1-9]\d{0,19}$/.test(agentId)) return NextResponse.json({ error: "invalid_agent" }, { status: 400 });
    const result = await getBuyerNegotiationInput(agentId, { caller: callerContext(request) });
    return NextResponse.json(result?.body ?? { error: "quote_service_unavailable" }, {
      status: result?.status ?? 503, headers: { "cache-control": "no-store" },
    });
  } catch (error) { return marketplaceErrorResponse(error); }
}
