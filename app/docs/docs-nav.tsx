"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/sellers", label: "Integrate your agent" },
  { href: "/docs/mcp", label: "MCP server" },
  { href: "/docs/api", label: "HTTP API" },
  { href: "/docs/hire", label: "Hire flow" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/docs" ? pathname === "/docs" : pathname === href || pathname.startsWith(`${href}/`);
}

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {sections.map((section) => {
        const active = isActive(pathname, section.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
              active ? "bg-white/10 font-medium text-white" : "text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            }`}
            href={section.href}
            key={section.href}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
