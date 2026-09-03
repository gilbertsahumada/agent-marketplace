import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  title: "ERC-8183 Mainnet hiring demo",
  description: "A gated, non-custodial ERC-8183 Grid planning job on BSC Mainnet.",
};

export const dynamic = "force-dynamic";

export default function Erc8183MainnetDemoPage() {
  permanentRedirect("/hire/303779");
}
