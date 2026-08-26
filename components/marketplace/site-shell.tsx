import Link from "next/link";
import { ChevronDown, GitFork } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "./wallet-connect-button";

const navigation = [
  { href: "/agents", label: "Agents" },
  { href: "/compare", label: "Compare" },
  { href: "/validate", label: "Validate" },
  { href: "/jobs/testnet/551", label: "Job proof" },
] as const;

function Brand() {
  return (
    <Link className="group inline-flex items-center gap-2.5" href="/">
      <span className="flex size-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 transition-colors group-hover:bg-primary/15">
        <img alt="" className="size-5" src="/logo/SVG/BNB Chain_Symbol_Yellow.svg" />
      </span>
      <span className="leading-none">
        <span className="block text-sm font-semibold tracking-tight text-white">BNB Agent Studio</span>
        <span className="font-eyebrow mt-1 block text-zinc-400">
          Evidence-first marketplace
        </span>
      </span>
    </Link>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-background/95">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Brand />

        <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
          {navigation.map((item) => (
            <Link
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild>
            <Link href="/agents">Explore on BSC</Link>
          </Button>
          <WalletConnectButton />
        </div>

        <details className="relative md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg border border-white/10 px-3 text-sm text-zinc-300 marker:hidden" tabIndex={0}>
            Menu
            <ChevronDown aria-hidden="true" className="size-4" />
          </summary>
          <nav
            aria-label="Mobile navigation"
            className="absolute right-0 top-[calc(100%+0.5rem)] w-52 rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
          >
            {navigation.map((item) => (
              <Link
                className="block rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-white/10 px-3 pt-3">
              <WalletConnectButton />
            </div>
          </nav>
        </details>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-zinc-950/50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
        <div>
          <Brand />
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-400">
            Discover, compare, and verify BSC agents without turning declarations into promises.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 text-sm text-zinc-400 md:justify-end">
          <Link className="hover:text-white" href="/agents">Agents</Link>
          <Link className="hover:text-white" href="/compare">Compare</Link>
          <Link className="hover:text-white" href="/validate">Validate my agent</Link>
          <Link className="hover:text-white" href="/evidence/verification">Methodology</Link>
          <Link className="hover:text-white" href="/jobs/testnet/551">Public proof</Link>
          <a
            aria-label="BNB Agent Marketplace on GitHub"
            className="inline-flex items-center gap-1.5 hover:text-white"
            href="https://github.com/gilbertsahumada/bnb-agent-marketplace"
            rel="noreferrer"
            target="_blank"
          >
            <GitFork aria-hidden="true" className="size-4" />
            GitHub
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-6 text-xs text-zinc-500 md:col-span-2">
          <img
            alt="Built on BNB Chain"
            className="h-3.5 w-auto opacity-50"
            src="/logo/SVG/BNB Chain_Logo_White.svg"
          />
          <p>
            Reputation data powered by{" "}
            <a
              className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-white"
              href="https://trust8004.xyz"
              rel="noreferrer"
              target="_blank"
            >
              trust8004.xyz
            </a>
          </p>
        </div>
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
