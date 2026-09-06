"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCatalogNavigation } from "./catalog-navigation";

export function catalogNetworkHref(href: string, network: "mainnet" | "testnet") {
  const url = new URL(href, "https://marketplace.invalid");
  url.searchParams.set("network", network);
  url.searchParams.delete("page");
  url.searchParams.delete("cursor");
  return `${url.pathname}${url.search}`;
}

export function CatalogNetworkTabs({ network, href, children }: {
  network: "mainnet" | "testnet"; href: string; children: ReactNode;
}) {
  const { navigate, pending } = useCatalogNavigation();
  return <Tabs value={network} onValueChange={(value) => {
    if (value === "mainnet" || value === "testnet") navigate(catalogNetworkHref(href, value));
  }} aria-busy={pending}>
    <TabsList variant="line" aria-label="Agent network">
      <TabsTrigger value="mainnet" disabled={pending}>Mainnet</TabsTrigger>
      <TabsTrigger value="testnet" disabled={pending}>Testnet</TabsTrigger>
    </TabsList>
    <TabsContent value={network}>{children}</TabsContent>
  </Tabs>;
}
