"use client";

import type { ReactNode } from "react";
import { NetworkSelector } from "./network-selector";
import { useCatalogNavigation } from "./catalog-navigation";

export function catalogNetworkHref(href: string, network: "mainnet" | "testnet") {
  const url = new URL(href, "https://marketplace.invalid");
  url.searchParams.set("network", network);
  url.searchParams.delete("page");
  url.searchParams.delete("cursor");
  return `${url.pathname}${url.search}`;
}

export function CatalogNetworkTabs({ network, href, children }: {
  network: "mainnet" | "testnet"; href: string; children?: ReactNode;
}) {
  const { navigate, pending } = useCatalogNavigation();
  return <div className="flex flex-col gap-2" aria-busy={pending}>
    <NetworkSelector network={network} label="Agent network" pending={pending}
      hrefs={{ mainnet: catalogNetworkHref(href, "mainnet"), testnet: catalogNetworkHref(href, "testnet") }}
      onSelect={value => navigate(catalogNetworkHref(href, value))} />
    {children}
  </div>;
}
