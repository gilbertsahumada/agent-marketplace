import { NextResponse } from "next/server";
import { getPublicJobProof } from "@/src/business/composition";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

export async function GET() {
  try {
    return NextResponse.json(await getPublicJobProof.execute({ jobId: "514" }));
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
