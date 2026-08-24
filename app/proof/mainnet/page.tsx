import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MainnetJobProofPage } from "@/components/marketplace/mainnet-job-proof-page";
import { getMainnetJobProof } from "@/src/business/composition";

export const metadata: Metadata = { title: "Primary BSC Mainnet hiring proof" };

export default function MainnetProofRoute() {
  const proof = getMainnetJobProof.execute();
  if (!proof) notFound();
  return <MainnetJobProofPage proof={proof} />;
}
