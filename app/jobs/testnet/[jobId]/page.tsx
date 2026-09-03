import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HireJobLedgerPage } from "@/components/marketplace/hire-job-ledger-page";
import { TestnetJobTracker } from "@/components/marketplace/testnet-job-tracker";
import { getErc8183TestnetJobTracking, getHireLedger } from "@/src/business/composition";
import {
  Erc8183DemoJobNotFoundError,
  Erc8183SpikeDisabledError,
  InvalidErc8183SpikeInputError,
} from "@/src/business/errors/erc8183-spike-errors";

export const metadata: Metadata = {
  title: "ERC-8183 Testnet job",
  description: "Direct-chain tracking and sanitized evidence for a controlled ERC-8183 Testnet job.",
};

export const dynamic = "force-dynamic";

export default async function TestnetJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    return <TestnetJobTracker tracking={await getErc8183TestnetJobTracking.execute({ jobId })} />;
  } catch (error) {
    if (error instanceof Erc8183DemoJobNotFoundError || error instanceof Erc8183SpikeDisabledError) {
      const ledger = /^(?:0|[1-9]\d{0,15})$/.test(jobId) ? await getHireLedger.getJob({ chainId: 97, jobId }) : null;
      if (ledger !== null) return <HireJobLedgerPage job={ledger} />;
      notFound();
    }
    if (error instanceof InvalidErc8183SpikeInputError) notFound();
    throw error;
  }
}
