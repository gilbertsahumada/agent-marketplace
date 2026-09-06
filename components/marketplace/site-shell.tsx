import type { ReactNode } from "react";
import { Brand } from "./site-brand";
import { SiteFooter } from "./site-footer";
import { MobileNav, PrimaryNav } from "./site-nav";
import { WalletConnectButton } from "./wallet-connect-button";

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
      <SiteFooter />
    </div>
  );
}
