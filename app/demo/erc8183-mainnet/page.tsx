import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Erc8183MainnetDemo } from "@/components/spikes/erc8183-browser-spike";
import { getMainnetBrowserDemoConfig } from "@/src/business/composition";

export const metadata: Metadata = {
  title: "ERC-8183 Mainnet hiring demo",
  description: "A gated, non-custodial ERC-8183 Grid planning job on BSC Mainnet.",
};

export const dynamic = "force-dynamic";

export default function Erc8183MainnetDemoPage() {
  if (Reflect.get(process.env, "ERC8183_MAINNET_DEMO_ENABLED") !== "true") notFound();
  return <Erc8183MainnetDemo config={getMainnetBrowserDemoConfig.execute()} />;
}
