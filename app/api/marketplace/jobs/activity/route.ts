import { NextResponse } from "next/server";
import { getHireLedger } from "@/src/business/composition";
import { InvalidMarketplaceInputError, MarketplaceDataUnavailableError } from "@/src/business/errors/marketplace-errors";
import {
  ACTIVITY_CACHE_HEADERS,
  addressParameter,
  agentIdParameter,
  allowlistedQuery,
  chainIdParameter,
  daysParameter,
} from "@/src/presentation/http/hire-ledger-http";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export const dynamic = "force-dynamic";

// Phase events per UTC day for one chain, one provider wallet or one agent,
// over the trailing window (30 days unless ?days= says otherwise, up to 90).
// Counts events the indexer saw; jobs backfilled by state contribute nothing.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    allowlistedQuery(url, ["chainId", "days", "provider", "agentId"]);
    const chainId = chainIdParameter(url.searchParams.get("chainId"));
    const days = daysParameter(url.searchParams.get("days"));
    const provider = addressParameter(url.searchParams.get("provider"), "provider");
    const agentId = agentIdParameter(url.searchParams.get("agentId"));
    if (provider !== undefined && agentId !== undefined) {
      throw new InvalidMarketplaceInputError("Use at most one of provider or agentId");
    }
    const activity = await getHireLedger.activity({
      chainId,
      ...(days === undefined ? {} : { days }),
      ...(provider === undefined ? {} : { provider }),
      ...(agentId === undefined ? {} : { agentId }),
    });
    if (activity === null) throw new MarketplaceDataUnavailableError("hire ledger activity");
    return NextResponse.json(activity, { headers: ACTIVITY_CACHE_HEADERS });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
