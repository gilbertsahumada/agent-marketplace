import { NextResponse } from "next/server";
import { catalogHireNetwork, catalogHireWritesEnabled } from "@/src/mainnet/catalog-hire-network";
import { CatalogErc8183Repository } from "@/src/mainnet/catalog-erc8183-repository";
import { CatalogHireUnavailableError, resolveCatalogHireTarget } from "@/src/mainnet/catalog-hire";
import { PrepareErc8183Hire } from "@/src/business/use-cases/prepare-erc8183-hire";
import { Erc8183SpikeDisabledError, InvalidErc8183SpikeInputError } from "@/src/business/errors/erc8183-spike-errors";
import { erc8183SpikeErrorResponse, spikeAddress, spikeJsonBody, spikeQuote } from "@/src/presentation/http/erc8183-spike-http";

function requestId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidErc8183SpikeInputError("quoteRequestId must be a positive request id");
  return value;
}

function response(error: unknown, chainId: 56 | 97): NextResponse {
  if (error instanceof CatalogHireUnavailableError) {
    return NextResponse.json({ error: { code: error.name, message: error.message } }, { status: 409 });
  }
  return erc8183SpikeErrorResponse(error, chainId === 97 ? "Testnet" : "Mainnet");
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  let chainId: 56 | 97 = 56;
  try {
    chainId = catalogHireNetwork(request);
    if (!catalogHireWritesEnabled(chainId)) throw new Erc8183SpikeDisabledError();
    const { agentId } = await context.params;
    const body = await spikeJsonBody(request);
    const target = await resolveCatalogHireTarget(agentId, requestId(body.quoteRequestId), { chainId });
    const repository = new CatalogErc8183Repository(target);
    return NextResponse.json(await (new PrepareErc8183Hire(repository)).execute({
      buyer: spikeAddress(body.buyer, "buyer"),
      quote: spikeQuote(body.quote),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) { return response(error, chainId); }
}
