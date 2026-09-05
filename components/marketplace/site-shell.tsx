import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNav, PrimaryNav } from "./site-nav";
import { WalletConnectButton } from "./wallet-connect-button";

function Brand() {
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

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-[72px] max-w-[1480px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <Brand />

        <PrimaryNav />

        <div className="hidden items-center gap-2 md:flex">
          <WalletConnectButton />
        </div>

        <MobileNav />
      </div>
    </header>
  );
}

function Footer() {
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

export function MarketplaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <Header />
      {children}
      <Footer />
    </div>
  );
}
