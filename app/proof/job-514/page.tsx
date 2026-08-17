import type { Metadata } from "next";
import { PublicProofPage } from "@/components/marketplace/public-proof-page";
import { getPublicJobProof } from "@/src/business/composition";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Public proof · Job 514" };

export default async function Job514ProofPage() {
  return <PublicProofPage proof={await getPublicJobProof.execute({ jobId: "514" })} />;
}
