import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Erc8183TestnetDemo } from "@/components/spikes/erc8183-browser-spike";

export const metadata: Metadata = {
  title: "ERC-8183 Testnet hiring demo",
  description: "A controlled, non-custodial ERC-8183 hiring journey on BSC Testnet.",
};

export const dynamic = "force-dynamic";

export default function Erc8183TestnetDemoPage() {
  const featureEnabled = Reflect.get(process.env, "ERC8183_BROWSER_SPIKE_ENABLED") === "true";
  if (!featureEnabled) notFound();
  return <Erc8183TestnetDemo />;
}
