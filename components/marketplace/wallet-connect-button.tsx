"use client";

import { Check, Copy, ExternalLink, LogOut, TriangleAlert, Wallet, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SUPPORTED_CHAINS,
  chainShortName,
  isSupportedChainId,
  shortAddress,
} from "@/lib/bsc-chains";
import { cn } from "@/lib/utils";

type InjectedFlags = { isMetaMask?: boolean; isCoinbaseWallet?: boolean };

function detectedWalletName(): { name: string; available: boolean } {
  const injected = (window as Window & { ethereum?: InjectedFlags }).ethereum;
  if (!injected) return { name: "MetaMask", available: false };
  if (injected.isMetaMask) return { name: "MetaMask", available: true };
  if (injected.isCoinbaseWallet) return { name: "Coinbase Wallet", available: true };
  return { name: "Browser Wallet", available: true };
}

function visibleWalletOptions(connectors: readonly Connector[], fallbackName: string) {
  const options = new Map<string, { connector: Connector; name: string }>();
  for (const connector of connectors) {
    const name = connector.name.toLowerCase() === "injected" ? fallbackName : connector.name;
    const key = name.trim().toLowerCase();
    const existing = options.get(key);
    if (!existing || (existing.connector.id === "injected" && connector.id !== "injected")) {
      options.set(key, { connector, name });
    }
  }
  return [...options.values()];
}

const panelClass =
  "absolute right-0 top-full z-100 mt-2 w-60 rounded-xl border border-white/10 bg-zinc-950 p-1 shadow-2xl";

export function WalletConnectButton({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, error: connectError, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  // Render the disconnected shape until mount so the server and client markup match.
  if (!mounted) {
    return (
      <Button disabled variant="outline">
        <Wallet aria-hidden="true" />
        {variant === "full" && "Connect wallet"}
      </Button>
    );
  }

  const onSupportedChain = isSupportedChainId(chainId);

  if (isConnected && address) {
    return (
      <div className="relative" ref={dropdownRef}>
        <Button
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className={cn(!onSupportedChain && "border-amber-400/40 text-amber-200")}
          onClick={() => setIsOpen(!isOpen)}
          variant="outline"
        >
          {onSupportedChain ? (
            <img alt="" className="size-4" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
          ) : (
            <TriangleAlert aria-hidden="true" />
          )}
          {onSupportedChain ? (
            <span className="font-hash">{shortAddress(address)}</span>
          ) : (
            "Wrong network"
          )}
        </Button>

        {isOpen && (
          <div className={panelClass}>
            {!onSupportedChain && (
              <p className="px-2 py-2 text-xs leading-relaxed text-amber-200">
                This app only supports BNB Smart Chain. Switch to continue.
              </p>
            )}

            <div className="px-2 py-2">
              <p className="font-eyebrow text-zinc-400">Address</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-hash cursor-help text-sm text-zinc-100">
                      {shortAddress(address)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px] break-all" side="left">
                    <span className="font-hash text-xs">{address}</span>
                  </TooltipContent>
                </Tooltip>
                <Button
                  aria-label="Copy wallet address"
                  onClick={() => void copyAddress()}
                  size="icon-xs"
                  variant="ghost"
                >
                  {copied ? <Check className="text-emerald-400" /> : <Copy />}
                </Button>
              </div>
              {copied && <p className="mt-1 text-[10px] text-emerald-400">Address copied</p>}
              {copyFailed && (
                <p className="mt-1 text-[10px] text-red-400">
                  Copying was blocked. Select the address instead.
                </p>
              )}
            </div>

            <div className="my-1 border-t border-white/10" />

            <p className="font-eyebrow px-2 py-1 text-zinc-400">Network</p>
            {SUPPORTED_CHAINS.map((chain) => (
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed",
                  chain.id === chainId
                    ? "text-zinc-400"
                    : "text-zinc-200 hover:bg-white/5 hover:text-white",
                )}
                disabled={chain.id === chainId}
                key={chain.id}
                onClick={() => {
                  switchChain({ chainId: chain.id });
                  setIsOpen(false);
                }}
                type="button"
              >
                <img alt="" className="size-3.5" src="/logo/SVG/BNB Chain_Symbol_White.svg" />
                <span className="flex-1">{chainShortName(chain.id)}</span>
                {chain.id === chainId && <Check aria-hidden="true" className="size-3 text-emerald-400" />}
              </button>
            ))}

            <div className="my-1 border-t border-white/10" />

            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-red-400"
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
              type="button"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const wallet = detectedWalletName();
  const walletOptions = visibleWalletOptions(connectors, wallet.name);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-busy={isPending}
        disabled={isPending}
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
      >
        {isPending ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="motion-safe:animate-spin" /> : <Wallet aria-hidden="true" data-icon="inline-start" />}
        {variant === "full" && (isPending ? "Connecting…" : "Connect wallet")}
      </Button>
      {!isOpen && connectError ? <p role="alert" className="mt-2 max-w-60 text-xs text-destructive">Connection did not complete. Try again.</p> : null}

      {isOpen && (
        <div className={panelClass}>
          <p className="font-eyebrow px-2 py-1.5 text-zinc-400">
            Select wallet
          </p>
          {wallet.available ? (
            walletOptions.map(({ connector, name }) => (
              <button
                className="flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-white/5 hover:text-white"
                key={connector.uid}
                onClick={() => {
                  connect({ connector });
                  setIsOpen(false);
                }}
                type="button"
              >
                {name}
              </button>
            ))
          ) : (
            <a
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              href="https://metamask.io/download/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Install MetaMask
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          )}
          {connectError && (
            <p className="px-2 py-2 text-xs leading-relaxed text-red-400">{connectError.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
