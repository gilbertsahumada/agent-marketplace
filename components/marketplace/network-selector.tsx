import Link from "next/link";
import { cn } from "@/lib/utils";

type Network = "mainnet" | "testnet";

/** Shared Jobs/Agents network control; navigation may be linked or pending-aware. */
export function NetworkSelector({ network, hrefs, onSelect, pending = false, label = "Network" }: {
  network: Network;
  hrefs: Record<Network, string>;
  onSelect?: (network: Network) => void;
  pending?: boolean;
  label?: string;
}) {
  return <nav aria-label={label} aria-busy={pending} className="flex h-9 w-fit items-stretch rounded-lg border border-border p-1 text-sm">
    {(["mainnet", "testnet"] as const).map(value => {
      const className = cn("flex items-center rounded-md px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-wait", value === network ? "bg-signal/5 text-signal ring-1 ring-signal/70" : "text-muted-foreground hover:text-foreground");
      const text = value === "mainnet" ? "BSC Mainnet" : "BSC Testnet";
      return onSelect
        ? <button key={value} type="button" aria-current={value === network ? "page" : undefined} disabled={pending} className={className} onClick={() => { if (value !== network) onSelect(value); }}>{text}</button>
        : <Link key={value} aria-current={value === network ? "page" : undefined} className={className} href={hrefs[value]}>{text}</Link>;
    })}
  </nav>;
}
