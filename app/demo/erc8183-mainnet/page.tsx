import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Erc8183MainnetDemo } from "@/components/spikes/erc8183-browser-spike";
import { getMainnetHiringExposure } from "@/src/business/composition";

export const metadata: Metadata = {
  title: "ERC-8183 Mainnet hiring demo",
  description: "A gated, non-custodial ERC-8183 Grid planning job on BSC Mainnet.",
};

export const dynamic = "force-dynamic";

export default async function Erc8183MainnetDemoPage() {
  const exposure = await getMainnetHiringExposure.execute();
  if (!exposure.demoConfig) notFound();
  return <Erc8183MainnetDemo config={exposure.demoConfig} />;
}
