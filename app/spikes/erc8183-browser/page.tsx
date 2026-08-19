import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Erc8183BrowserSpike } from "@/components/spikes/erc8183-browser-spike";

export const metadata: Metadata = {
  title: "ERC-8183 browser wallet spike",
  description: "Experimental, Testnet-only, non-custodial ERC-8183 buyer flow.",
};

export const dynamic = "force-dynamic";

export default function Erc8183BrowserSpikePage() {
  const featureEnabled = Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
  if (!featureEnabled) notFound();
  return <Erc8183BrowserSpike />;
}
