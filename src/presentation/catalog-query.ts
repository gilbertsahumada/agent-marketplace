import { CATALOG_STATUSES } from "../business/entities/catalog-candidate";
import { MARKETPLACE_CATEGORIES } from "../business/entities/marketplace-agent";
import { MARKETPLACE_PROTOCOLS, MARKETPLACE_REACHABILITY, MARKETPLACE_DATA_SORTS, DEFAULT_REGISTERED_AGENT_SORT } from "../business/use-cases/list-marketplace-agents";

export type CatalogParams = Record<string, string | string[] | undefined>;
export function normalizeCatalogQuery(params: CatalogParams) {
  const single = (key: string, fallback?: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("INVALID_CATALOG_QUERY");
    return value ?? fallback;
  };
  const choice = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
    const value = single(key, fallback);
    if (!choices.includes(value as T)) throw new Error("INVALID_CATALOG_QUERY");
    return value as T;
  };
  const values = <T extends string>(key: string, choices: readonly T[]): T[] => {
    const raw = params[key]; const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (list.some(v => !choices.includes(v as T))) throw new Error("INVALID_CATALOG_QUERY");
    return [...new Set(list as T[])].sort();
  };
  const view = choice("view", ["all", "marketplace"], "marketplace");
  const network = choice("network", ["mainnet", "testnet"], "mainnet");
  const scope = choice("scope", ["all", "hiring", "evaluation"], "all");
  const rawPage = single("page", "1")!;
  const page = Number(rawPage);
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1) throw new Error("INVALID_CATALOG_QUERY");
  const q = single("q")?.trim();
  if (q && q.length > 120) throw new Error("INVALID_CATALOG_QUERY");
  const rawSort = single("sort");
  const sort = rawSort && MARKETPLACE_DATA_SORTS.includes(rawSort as typeof MARKETPLACE_DATA_SORTS[number]) ? rawSort as typeof MARKETPLACE_DATA_SORTS[number] : view === "all" ? DEFAULT_REGISTERED_AGENT_SORT : undefined;
  return { view, network, scope, page, statuses: values("status", CATALOG_STATUSES), categories: view === "all" ? [] : values("category", MARKETPLACE_CATEGORIES), protocols: values("protocol", MARKETPLACE_PROTOCOLS), reachability: view === "all" ? [] : values("reachability", MARKETPLACE_REACHABILITY), ...(q ? { q } : {}), ...(sort ? { sort } : {}) };
}
export type CatalogQuery = ReturnType<typeof normalizeCatalogQuery>;
export function catalogQueryHref(query: CatalogQuery, page = query.page) {
  const p = new URLSearchParams({ view: query.view, network: query.network, scope: query.scope, page: String(page), limit: "24" });
  for (const [key, values] of [["status", query.statuses], ["category", query.categories], ["protocol", query.protocols], ["reachability", query.reachability]] as const) for (const value of values) p.append(key, value);
  if (query.q) p.set("q", query.q);
  if (query.sort) p.set("sort", query.sort);
  return `/agents?${p}`;
}
