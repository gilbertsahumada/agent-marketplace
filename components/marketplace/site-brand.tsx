import Link from "next/link";

export function Brand() {
  return (
    <Link className="group inline-flex items-center gap-2.5" href="/">
      <img alt="" className="size-7" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
      <span className="leading-none">
        <span className="block text-sm font-semibold tracking-tight text-foreground">BNB Agent Marketplace</span>
        <span className="font-stat mt-1 block text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Verified onchain work</span>
      </span>
    </Link>
  );
}
