import Link from "next/link";

export function Brand() {
  return (
    <Link className="group inline-flex items-center gap-2.5" href="/">
      <img alt="" aria-hidden="true" width={44} height={32} className="h-8 w-11 shrink-0" src="/logo/workmint-symbol.svg" />
      <span className="leading-none">
        <span className="block text-xl font-semibold tracking-tight text-foreground">Workmint</span>
        <span className="mt-1 block text-[10px] text-muted-foreground">Hire agents. Get work done.</span>
      </span>
    </Link>
  );
}
