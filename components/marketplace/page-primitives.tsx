import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { paginationSummary } from "./pagination-summary";

export function Breadcrumb({ trail, current }: { trail: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-zinc-400">
        {trail.map(({ href, label }) => (
          <li className="flex min-w-0 items-center gap-x-1.5" key={href}>
            <Link className="truncate transition-colors hover:text-white" href={href}>{label}</Link>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-zinc-600" />
          </li>
        ))}
        <li aria-current="page" className="min-w-0 truncate text-zinc-200">{current}</li>
      </ol>
    </nav>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <header className="max-w-3xl">
      <p className="font-eyebrow font-eyebrow-dot text-zinc-500">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-light tracking-tight text-white sm:text-4xl">{title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">{children}</div>
    </header>
  );
}

export function CoverageBadge({ total, scope = "marketplace" }: { total?: number; scope?: "marketplace" | "registry" }) {
  const count = typeof total === "number" ? ` · ${total.toLocaleString()} agents` : "";
  return (
    <Badge className="border-zinc-700 bg-zinc-900 text-zinc-300" variant="outline">
      {scope === "registry" ? "All registered agents" : "Operational candidates"}{count}
    </Badge>
  );
}

export function PaginationLinks({ page, totalPages, hrefFor, total, shown }: { page: number; totalPages: number; hrefFor: (page: number) => string; total: number; pageSize: number; shown: number }) {
  return (
    <nav aria-label="Catalog pagination" className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/10 pt-6 [&>a:first-child]:justify-self-start [&>button:first-child]:justify-self-start [&>a:last-child]:justify-self-end [&>button:last-child]:justify-self-end">
      {page > 1
        ? <Button asChild variant="outline"><Link href={hrefFor(page - 1)}><ChevronLeft aria-hidden="true" />Previous</Link></Button>
        : <Button disabled variant="outline"><ChevronLeft aria-hidden="true" />Previous</Button>}
      <span role="status" className="font-stat max-w-32 text-center text-xs text-muted-foreground sm:max-w-none">{paginationSummary(shown, total)}</span>
      {page < totalPages
        ? <Button asChild variant="outline"><Link href={hrefFor(page + 1)}>Next<ChevronRight aria-hidden="true" /></Link></Button>
        : <Button disabled variant="outline">Next<ChevronRight aria-hidden="true" /></Button>}
    </nav>
  );
}
