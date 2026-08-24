import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <header className="max-w-3xl">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">{children}</div>
    </header>
  );
}

export function CoverageBadge({ total }: { total?: number }) {
  return (
    <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200" variant="outline">
      Catalog coverage: partial{typeof total === "number" ? ` · ${total.toLocaleString()} active indexed BSC records returned by trust8004` : ""}
    </Badge>
  );
}

export function PaginationLinks({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Catalog pagination" className="mt-8 flex items-center justify-between gap-4 border-t border-white/10 pt-6">
      <Button asChild={page > 1} disabled={page <= 1} variant="outline">
        {page > 1 ? <Link href={hrefFor(page - 1)}><ChevronLeft aria-hidden="true" />Previous</Link> : <span><ChevronLeft aria-hidden="true" />Previous</span>}
      </Button>
      <span className="font-stat text-xs text-zinc-400">Page {page} of {totalPages}</span>
      <Button asChild={page < totalPages} disabled={page >= totalPages} variant="outline">
        {page < totalPages ? <Link href={hrefFor(page + 1)}>Next<ChevronRight aria-hidden="true" /></Link> : <span>Next<ChevronRight aria-hidden="true" /></span>}
      </Button>
    </nav>
  );
}
