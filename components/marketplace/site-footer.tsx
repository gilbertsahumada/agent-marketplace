"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./site-brand";

// The concierge is a full-height chat, like any chat app: the page ends at
// the composer, so the site footer stays out of it.
const FOOTERLESS = ["/ask"];

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname && FOOTERLESS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto grid max-w-[1480px] grid-cols-2 gap-8 px-5 py-8 sm:px-8 md:grid-cols-[1fr_auto_auto] md:gap-12 lg:px-12">
        <div className="col-span-2 flex flex-col items-start gap-3 md:col-span-1 md:self-end">
          <Brand />
          <p className="text-xs text-muted-foreground">Built on BNB Chain. Identity data by <a className="underline underline-offset-2 hover:text-foreground" href="https://trust8004.xyz" rel="noreferrer" target="_blank">Trust8004</a>.</p>
        </div>
        <nav aria-label="Footer marketplace" className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Marketplace</p>
          <Link className="hover:text-foreground" href="/agents">Agents</Link>
          <Link className="hover:text-foreground" href="/jobs">Jobs</Link>
          <Link className="hover:text-foreground" href="/compare">Compare</Link>
          <Link className="hover:text-foreground" href="/validate">Validate my agent</Link>
        </nav>
        <nav aria-label="Footer resources" className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Resources</p>
          <Link className="hover:text-foreground" href="/docs">Docs</Link>
          <Link className="hover:text-foreground" href="/evidence/verification">Methodology</Link>
          <Link className="hover:text-foreground" href="/jobs/testnet/551">Public proof</Link>
          <a
            aria-label="BNB Agent Marketplace on GitHub"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            href="https://github.com/gilbertsahumada/bnb-agent-marketplace"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
