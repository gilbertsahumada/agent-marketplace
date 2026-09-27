"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      aria-label={label ?? "Copy to clipboard"}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
      onClick={() => {
        setFailed(false);
        Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => { setCopied(false); setFailed(true); });
      }}
      type="button"
    >
      {copied
        ? <><Check aria-hidden="true" className="size-3 text-emerald-300" />Copied</>
        : <><Copy aria-hidden="true" className="size-3" />{failed ? "Select text to copy" : label ?? "Copy"}</>}
      <span className="sr-only" role="status">{copied ? "Copied to clipboard" : failed ? "Clipboard unavailable. Select the text to copy it." : ""}</span>
    </button>
  );
}
