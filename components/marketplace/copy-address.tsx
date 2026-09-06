"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddressLink } from "./address-link";

export function CopyAddress({ address, chainId }: { address: string; chainId: 56 | 97 }) {
  const [status, setStatus] = useState("");
  return <span className="inline-flex items-center gap-1 text-xs">
    <AddressLink address={address} chainId={chainId} />
    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy address ${address}`} onClick={async () => {
      try { await navigator.clipboard.writeText(address); setStatus("Copied"); } catch { setStatus("Could not copy"); }
    }}>{status === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
    <span role="status" className="sr-only">{status}</span>
  </span>;
}
