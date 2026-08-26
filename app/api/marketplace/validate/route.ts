import { NextResponse } from "next/server";
import { validateMarketplaceAgent } from "@/src/business/composition";
import { InvalidMarketplaceInputError } from "@/src/business/errors/marketplace-errors";
import { marketplaceErrorResponse } from "@/src/presentation/http/marketplace-http";

function validationInput(raw: string): { agentId: string } {
  if (raw.length > 256) throw new InvalidMarketplaceInputError("Validation input is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidMarketplaceInputError("Validation input must be JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMarketplaceInputError("Validation input must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "agentId" || typeof entries[0][1] !== "string") {
    throw new InvalidMarketplaceInputError("Validation accepts only agentId");
  }
  return { agentId: entries[0][1] };
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new InvalidMarketplaceInputError("Content-Type must be application/json");
    }
    const result = await validateMarketplaceAgent.execute(validationInput(await request.text()));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marketplaceErrorResponse(error);
  }
}
