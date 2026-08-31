"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label ?? "Copy to clipboard"}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
      type="button"
    >
      {copied
        ? <><Check aria-hidden="true" className="size-3 text-emerald-300" />Copied</>
        : <><Copy aria-hidden="true" className="size-3" />{label ?? "Copy"}</>}
    </button>
  );
}
