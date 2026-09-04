import { getHireLedger } from "@/src/business/composition";
import { HireJobNotFoundError } from "@/src/business/errors/marketplace-errors";
import { jobIdParameter, ledgerResponse } from "@/src/presentation/http/hire-ledger-http";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export const dynamic = "force-dynamic";

// The indexed ledger of one BSC Mainnet job: state, phase events and the
// marketplace's own chain-verified hire events for it.
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const id = jobIdParameter(jobId, "jobId") as string;
    const job = await getHireLedger.getJob({ chainId: 56, jobId: id });
    if (job === null) throw new HireJobNotFoundError(56, id);
    return ledgerResponse(job, "hire ledger job");
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
