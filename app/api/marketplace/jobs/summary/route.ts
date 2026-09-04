import { getHireLedger } from "@/src/business/composition";
import { allowlistedQuery, chainIdParameter, ledgerResponse } from "@/src/presentation/http/hire-ledger-http";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export const dynamic = "force-dynamic";

// Protocol-wide versus marketplace-processed counts per job status, plus the
// block the indexer has reached.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    allowlistedQuery(url, ["chainId"]);
    const chainId = chainIdParameter(url.searchParams.get("chainId"));
    return ledgerResponse(await getHireLedger.summary({ chainId }), "hire ledger summary");
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
