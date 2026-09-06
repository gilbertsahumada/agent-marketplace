"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuoteDetails({ requestHash }: { requestHash: string }) {
  const [copyStatus, setCopyStatus] = useState("");
  return <details className="group mt-4 text-xs text-muted-foreground">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      Quote details
      <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span>Request hash</span>
      <code title={requestHash} className="break-all text-foreground">{requestHash.length > 22 ? `${requestHash.slice(0, 12)}…${requestHash.slice(-8)}` : requestHash}</code>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy request hash" onClick={async () => {
        try { await navigator.clipboard.writeText(requestHash); setCopyStatus("Copied"); }
        catch { setCopyStatus("Could not copy. Select the full hash below."); }
      }}>{copyStatus === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button>
      <span role="status">{copyStatus}</span>
    </div>
    {copyStatus.startsWith("Could not copy") ? <code className="mt-2 block select-all break-all">{requestHash}</code> : null}
  </details>;
}
