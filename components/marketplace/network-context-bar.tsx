"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { chainShortName, isSupportedChainId } from "@/lib/bsc-chains";
import { cn } from "@/lib/utils";

export function NetworkContextBar() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const walletConnected = mounted && isConnected;
  const supportedWalletNetwork = walletConnected && isSupportedChainId(chainId);
  const networkLabel = supportedWalletNetwork ? chainShortName(chainId) : walletConnected ? `Chain ${chainId}` : "BSC Mainnet";
  const unsupported = walletConnected && !supportedWalletNetwork;

  return (
    <aside
      aria-label="Network context"
      aria-live="polite"
      className={cn(
        "border-b border-white/[0.06] bg-zinc-950/70",
        unsupported && "border-amber-400/20 bg-amber-400/[0.04]",
      )}
    >
      <div className="mx-auto flex min-h-7 max-w-7xl items-center justify-center gap-2 px-4 text-[11px] sm:px-6 lg:px-8">
        {unsupported ? (
          <TriangleAlert aria-hidden="true" className="size-3.5 text-amber-300" />
        ) : (
          <img alt="" className="size-3 opacity-80" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
        )}
        <span className={cn("font-stat font-medium", unsupported ? "text-amber-200" : "text-zinc-200")}>
          {unsupported ? `Unsupported network · ${networkLabel}` : networkLabel}
        </span>
        <span className="text-zinc-500">·</span>
        <span className={unsupported ? "text-amber-200/70" : "text-zinc-500"}>
          {walletConnected ? "Connected wallet" : "Default network"}
        </span>
      </div>
    </aside>
  );
}
