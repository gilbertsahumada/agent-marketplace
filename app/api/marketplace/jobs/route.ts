import { getHireLedger } from "@/src/business/composition";
import { InvalidMarketplaceInputError } from "@/src/business/errors/marketplace-errors";
import {
  addressParameter,
  agentIdParameter,
  allowlistedQuery,
  chainIdParameter,
  daysParameter,
  jobIdParameter,
  ledgerResponse,
} from "@/src/presentation/http/hire-ledger-http";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export const dynamic = "force-dynamic";

// Indexed on-chain jobs, newest first, optionally scoped to one buyer wallet,
// one provider wallet or one marketplace agent. Activity, not a track record.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    allowlistedQuery(url, ["chainId", "buyer", "provider", "agentId", "before", "days"]);
    const chainId = chainIdParameter(url.searchParams.get("chainId"));
    const buyer = addressParameter(url.searchParams.get("buyer"), "buyer");
    const provider = addressParameter(url.searchParams.get("provider"), "provider");
    const agentId = agentIdParameter(url.searchParams.get("agentId"));
    const before = jobIdParameter(url.searchParams.get("before"), "before");
    const days = daysParameter(url.searchParams.get("days"));
    const period = days === undefined ? {} : { days };
    if ([buyer, provider, agentId].filter((value) => value !== undefined).length > 1) {
      throw new InvalidMarketplaceInputError("Use at most one of buyer, provider or agentId");
    }
    const ledger = getHireLedger;
    const page = buyer !== undefined
      ? await ledger.listJobsByBuyer({ chainId, buyer, ...period, ...(before === undefined ? {} : { before }) })
      : provider !== undefined
        ? await ledger.listJobsByProvider({ chainId, provider, ...period, ...(before === undefined ? {} : { before }) })
        : agentId !== undefined
          ? await ledger.listJobsByAgent({ chainId, agentId, ...period, ...(before === undefined ? {} : { before }) })
          : await ledger.listRecentJobs({ chainId, ...period, ...(before === undefined ? {} : { before }) });
    return ledgerResponse(page, "hire ledger jobs");
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
