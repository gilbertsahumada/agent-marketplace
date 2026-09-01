import { NextResponse } from "next/server";
import { listMarketplaceAgents } from "@/src/business/composition";
import { InvalidMarketplaceInputError } from "@/src/business/errors/marketplace-errors";
import { CATALOG_STATUSES, type CatalogStatus } from "@/src/business/entities/catalog-candidate";
import { MARKETPLACE_CATEGORIES, type MarketplaceCategory } from "@/src/business/entities/marketplace-agent";
import {
  MARKETPLACE_AVAILABILITIES,
  MARKETPLACE_COMMERCE,
  MARKETPLACE_DATA_SORTS,
  MARKETPLACE_PROTOCOLS,
  MARKETPLACE_QUOTES,
  MARKETPLACE_REACHABILITY,
  type MarketplaceAvailability,
  type MarketplaceCommerce,
  type MarketplaceProtocol,
  type MarketplaceQuote,
  type MarketplaceReachability,
  type MarketplaceSort,
} from "@/src/business/use-cases/list-marketplace-agents";
import { integerParameter, marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

const SORTS = new Set<MarketplaceSort>(MARKETPLACE_DATA_SORTS);
const AVAILABILITIES = new Set<MarketplaceAvailability>(MARKETPLACE_AVAILABILITIES);

function parseValues<const T extends readonly string[]>(
  values: string[],
  allowed: T,
  label: string,
): Array<T[number]> {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length > allowed.length || unique.some((value) => !allowed.includes(value))) {
    throw new InvalidMarketplaceInputError(`Unsupported ${label} filter`);
  }
  return unique as Array<T[number]>;
}

function multiParameter<const T extends readonly string[]>(
  params: URLSearchParams,
  key: string,
  allowed: T,
  label: string,
): Array<T[number]> {
  return parseValues(params.getAll(key), allowed, label);
}

function categoryParameters(params: URLSearchParams): MarketplaceCategory[] {
  const values = params.getAll("category").map((value) => value.trim()).filter(Boolean);
  const withoutAll = values.filter((value) => value !== "all");
  if (values.includes("all") && withoutAll.length > 0) {
    throw new InvalidMarketplaceInputError("category=all cannot be combined with a category filter");
  }
  return parseValues(withoutAll, MARKETPLACE_CATEGORIES, "category") as MarketplaceCategory[];
}

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
        const categories = categoryParameters(params);
        const statuses = multiParameter(params, "status", CATALOG_STATUSES, "status") as CatalogStatus[];
        const protocols = multiParameter(params, "protocol", MARKETPLACE_PROTOCOLS, "protocol") as MarketplaceProtocol[];
        const reachability = multiParameter(params, "reachability", MARKETPLACE_REACHABILITY, "reachability") as MarketplaceReachability[];
        const commerce = multiParameter(params, "commerce", MARKETPLACE_COMMERCE, "commerce") as MarketplaceCommerce[];
        const quote = multiParameter(params, "quote", MARKETPLACE_QUOTES, "quote") as MarketplaceQuote[];
        const latestFailureValue = params.get("latestFailure");
        if (latestFailureValue !== null && latestFailureValue !== "true" && latestFailureValue !== "false") {
          throw new InvalidMarketplaceInputError("latestFailure must be true or false");
        }
        const availability = availabilityValue as MarketplaceAvailability | null;
        return {
          ...(categories.length === 1 ? { category: categories[0] } : {}),
          ...(categories.length > 1 ? { categories } : {}),
          ...(statuses.length > 0 ? { statuses } : {}),
          ...(protocols.length > 0 ? { protocols } : {}),
          ...(reachability.length > 0 ? { reachability } : {}),
          ...(commerce.length > 0 ? { commerce } : {}),
          ...(quote.length > 0 ? { quote } : {}),
          ...(latestFailureValue === null ? {} : { latestFailure: latestFailureValue === "true" }),
          ...(availability ? { availability } : {}),
        };
      })() });
    return NextResponse.json(result);
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
