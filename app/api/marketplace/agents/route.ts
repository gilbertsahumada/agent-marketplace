import { NextResponse } from "next/server";
import { listMarketplaceAgents } from "@/src/business/composition";
import { InvalidMarketplaceInputError } from "@/src/business/errors/marketplace-errors";
import {
  MARKETPLACE_AVAILABILITIES,
  MARKETPLACE_DATA_SORTS,
  type MarketplaceAvailability,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { categoryParameter, integerParameter, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const SORTS = new Set<MarketplaceSort>(MARKETPLACE_DATA_SORTS);
const AVAILABILITIES = new Set<MarketplaceAvailability>(MARKETPLACE_AVAILABILITIES);

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const view = params.get("view") ?? "marketplace";
    if (view !== "all" && view !== "marketplace") throw new InvalidMarketplaceInputError("view must be all or marketplace");
    const sortValue = params.get("sort");
    if (sortValue && !SORTS.has(sortValue as MarketplaceSort)) {
      throw new InvalidMarketplaceInputError("Unsupported sort value");
    }
    const sort = sortValue && SORTS.has(sortValue as MarketplaceSort)
      ? sortValue as MarketplaceSort
      : undefined;
    const base = {
      page: integerParameter(params.get("page"), 1, "page"),
      limit: integerParameter(params.get("limit"), view === "all" ? 24 : 12, "limit"),
      ...(params.get("q") ? { q: params.get("q")! } : {}),
      ...(sort ? { sort } : {}),
    };
    const availabilityValue = params.get("availability");
    if (availabilityValue && !AVAILABILITIES.has(availabilityValue as MarketplaceAvailability)) {
      throw new InvalidMarketplaceInputError("availability must be all, hireable or mcp_only");
    }
    const result = view === "all"
      ? await listMarketplaceAgents.execute({ view, ...base })
      : await listMarketplaceAgents.execute({ view, ...base, ...(() => {
        const category = categoryParameter(params.get("category"));
        const availability = availabilityValue as MarketplaceAvailability | null;
        return { ...(category ? { category } : {}), ...(availability ? { availability } : {}) };
      })() });
    return NextResponse.json(result);
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
