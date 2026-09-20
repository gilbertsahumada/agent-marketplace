"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokenAmount } from "@/src/business/entities/token-amount";
import {
  defaultPaymentToken,
  paymentTokenMetadata,
  type PaymentTokenChainId,
} from "@/src/business/entities/payment-token";
import { explorerUrl } from "./hire-job-rows";

function TokenIcon({ logoUrl, name, symbol }: { logoUrl: string; name: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative grid size-5 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-white/[0.06] text-[8px] font-semibold text-foreground">
      <span aria-hidden="true">{symbol.slice(0, 2)}</span>
      {!failed ? <img alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} src={logoUrl} /> : null}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function PaymentTokenIdentity({ address, chainId }: {
  address?: string | null;
  chainId: PaymentTokenChainId;
}) {
  // Undefined means a legacy response from before the indexer exposed this
  // field. Null means the chain read could not prove a token, so do not guess.
  const token = address === undefined
    ? defaultPaymentToken(chainId)
    : paymentTokenMetadata(chainId, address);
  const tokenAddress = token?.address ?? address;
  const symbol = token?.symbol ?? "Token";
  return (
    <span className="inline-flex items-center gap-2">
      {token ? <TokenIcon logoUrl={token.logoUrl} name={token.name} symbol={token.symbol} /> : (
        <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-[8px] font-semibold">?</span>
      )}
      {tokenAddress ? (
        <a
          aria-label={`${symbol} token on explorer, opens in a new tab`}
          className="inline-flex items-center gap-1 text-signal underline decoration-signal/30 underline-offset-4 hover:decoration-signal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
          href={`${explorerUrl(chainId)}/address/${tokenAddress}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {symbol}<ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : <span>{symbol}</span>}
    </span>
  );
}

export function PaymentTokenAmount({ address, amountRaw, chainId, className }: {
  address?: string | null;
  amountRaw: string;
  chainId: PaymentTokenChainId;
  className?: string;
}) {
  const token = address === undefined ? defaultPaymentToken(chainId) : paymentTokenMetadata(chainId, address);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <span>{formatTokenAmount(amountRaw, token?.decimals ?? 18)}</span>
      <PaymentTokenIdentity {...(address === undefined ? {} : { address })} chainId={chainId} />
    </span>
  );
}
