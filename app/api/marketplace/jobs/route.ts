import { getHireLedger } from "@/src/business/composition";
import { InvalidMarketplaceInputError } from "@/src/business/errors/marketplace-errors";
import {
  addressParameter,
  agentIdParameter,
  allowlistedQuery,
  chainIdParameter,
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
    allowlistedQuery(url, ["chainId", "buyer", "provider", "agentId", "before"]);
    const chainId = chainIdParameter(url.searchParams.get("chainId"));
    const buyer = addressParameter(url.searchParams.get("buyer"), "buyer");
    const provider = addressParameter(url.searchParams.get("provider"), "provider");
    const agentId = agentIdParameter(url.searchParams.get("agentId"));
    const before = jobIdParameter(url.searchParams.get("before"), "before");
    if ([buyer, provider, agentId].filter((value) => value !== undefined).length > 1) {
      throw new InvalidMarketplaceInputError("Use at most one of buyer, provider or agentId");
    }
    const ledger = getHireLedger;
    const page = buyer !== undefined
      ? await ledger.listJobsByBuyer({ chainId, buyer, ...(before === undefined ? {} : { before }) })
      : provider !== undefined
        ? await ledger.listJobsByProvider({ chainId, provider, ...(before === undefined ? {} : { before }) })
        : agentId !== undefined
          ? await ledger.listJobsByAgent({ chainId, agentId, ...(before === undefined ? {} : { before }) })
          : await ledger.listRecentJobs({ chainId, ...(before === undefined ? {} : { before }) });
    return ledgerResponse(page, "hire ledger jobs");
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
