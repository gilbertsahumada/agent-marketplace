import { cookies } from "next/headers";
import { normalizeCatalogQuery, type CatalogParams } from "@/src/presentation/catalog-query";
import { readCatalogResource } from "@/src/presentation/catalog-resources";
import type { CatalogResourceName } from "@/src/business/entities/catalog-resource";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resource = params.get("resource");
  const allowed = new Set(["resource", "view", "network", "scope", "page", "limit", "q", "sort", "status", "category", "protocol", "reachability"]);
  if (params.getAll("resource").length !== 1 || !["results", "facets", "scopes"].includes(resource ?? "") || [...params.keys()].some(key => !allowed.has(key))) return Response.json({ error: "INVALID_CATALOG_QUERY" }, { status: 400 });
  const input: CatalogParams = {};
  for (const key of new Set(params.keys())) { const values = params.getAll(key); input[key] = values.length === 1 ? values[0] : values; }
  let query;
  try { query = normalizeCatalogQuery(input); } catch { return Response.json({ error: "INVALID_CATALOG_QUERY" }, { status: 400 }); }
  const fresh = (await cookies()).get("marketplace_evidence_refresh")?.value === "1";
  const result = await readCatalogResource(resource as CatalogResourceName, query, fresh);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
