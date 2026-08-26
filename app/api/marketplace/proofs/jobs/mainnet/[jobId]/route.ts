import { NextResponse } from "next/server";
import { getPublicMainnetJobProof } from "@/src/business/composition";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    return NextResponse.json(getPublicMainnetJobProof.execute({ jobId }), {
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
