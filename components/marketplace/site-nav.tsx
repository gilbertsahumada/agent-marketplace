"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WalletConnectButton } from "./wallet-connect-button";

const navigation = [
  { href: "/agents", label: "Agents" },
  { href: "/compare", label: "Compare" },
  { href: "/validate", label: "Validate" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function linkClassName(active: boolean, block: boolean): string {
  const layout = block ? "block rounded-lg px-3 py-2.5 text-sm" : "rounded-lg px-3 py-2 text-sm";
  return active
    ? `${layout} bg-white/10 font-medium text-white`
    : `${layout} text-zinc-400 transition-colors hover:bg-white/5 hover:text-white`;
}

export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
      {navigation.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={linkClassName(active, false)}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  return (
    <div className="relative md:hidden" ref={container}>
      <button
        aria-controls="mobile-navigation"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-1 rounded-lg border border-white/10 px-3 text-sm text-zinc-300"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Menu
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <nav
          aria-label="Mobile navigation"
          className="absolute right-0 top-[calc(100%+0.5rem)] w-52 rounded-xl border border-white/10 bg-zinc-950 p-2 shadow-2xl"
          id="mobile-navigation"
        >
          {navigation.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={linkClassName(active, true)}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="mt-2 border-t border-white/10 px-3 pt-3">
            <WalletConnectButton />
          </div>
        </nav>
      )}
    </div>
  );
}
