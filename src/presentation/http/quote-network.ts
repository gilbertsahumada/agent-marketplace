import { InvalidMarketplaceInputError } from "../../business/errors/marketplace-errors";

export function quoteNetwork(request: Request): 56 | 97 {
  const values = new URL(request.url).searchParams.getAll("chainId");
  if (values.length === 0) return 56;
  if (values.length === 1 && values[0] === "56") return 56;
  if (values.length === 1 && values[0] === "97") return 97;
  throw new InvalidMarketplaceInputError("Invalid quote network");
}
