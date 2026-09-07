import "server-only";
import { InvalidErc8183SpikeInputError } from "../business/errors/erc8183-spike-errors.ts";
import { areMainnetWritesEnabled } from "./mainnet-write-gate.ts";

export function catalogHireNetwork(request: Request): 56 | 97 {
  const values = new URL(request.url).searchParams.getAll("chainId");
  if (values.length === 0 || (values.length === 1 && values[0] === "56")) return 56;
  if (values.length === 1 && values[0] === "97") return 97;
  throw new InvalidErc8183SpikeInputError("Unsupported or ambiguous hire network");
}

export function catalogHireWritesEnabled(chainId: 56 | 97, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return chainId === 97 ? env.ERC8183_TESTNET_HIRE_ENABLED === "true" : areMainnetWritesEnabled(env);
}
