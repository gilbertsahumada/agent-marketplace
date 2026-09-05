import { ExternalLink } from "lucide-react";
import { shortAddress } from "@/lib/bsc-chains";
import { ERC8183_MAINNET, ERC8183_TESTNET } from "@/src/business/browser/erc8183-browser-wallet";
import type { HireChainId } from "@/src/business/entities/hire-job";

export function AddressLink({ address, chainId, full = false }: {
  address: string;
  chainId: HireChainId;
  full?: boolean;
}) {
  const explorer = chainId === 56 ? ERC8183_MAINNET.explorerUrl : ERC8183_TESTNET.explorerUrl;
  return (
    <a
      href={`${explorer}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      aria-label={`${address} on BscScan (${chainId === 56 ? "Mainnet" : "Testnet"}), opens in a new tab`}
      className="inline-flex max-w-full items-center gap-1.5 text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
    >
      <span className={full ? "break-all" : ""}>{full ? address : shortAddress(address)}</span>
      <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
    </a>
  );
}
