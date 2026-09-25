import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ProgressiveCatalog } from "@/components/marketplace/progressive-catalog";
import { normalizeCatalogQuery, type CatalogParams } from "@/src/presentation/catalog-query";
import { createCatalogResources } from "@/src/presentation/catalog-resources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BSC agents" };
export default async function AgentsPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  let query;
  try { query = normalizeCatalogQuery(await searchParams); } catch { notFound(); }
  const fresh = (await cookies()).get("marketplace_evidence_refresh")?.value === "1";
  return <ProgressiveCatalog key={JSON.stringify(query)} query={query} resources={createCatalogResources(query, fresh)} />;
}
