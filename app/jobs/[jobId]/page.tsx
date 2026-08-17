import { notFound } from "next/navigation";
import { PublicProofPage } from "@/components/marketplace/public-proof-page";
import { getPublicJobProof } from "@/src/business/composition";
import { PublicJobProofNotFoundError } from "@/src/business/errors/public-job-proof-errors";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    return <PublicProofPage proof={await getPublicJobProof.execute({ jobId })} />;
  } catch (error) {
    if (error instanceof PublicJobProofNotFoundError) notFound();
    throw error;
  }
}
