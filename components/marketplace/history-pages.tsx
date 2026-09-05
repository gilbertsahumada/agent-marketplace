"use client";
import { Children, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";

export function HistoryPages({ children, label, olderHref, newestHref, columns, emptyContent }: { children: ReactNode; label: string; olderHref?: string; newestHref?: string; columns?: string[]; emptyContent?: ReactNode }) {
  const rows = Children.toArray(children);
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / 5) - 1);
  const current = Math.min(page, last);
  return <>
    {columns ? <Table containerLabel={`${label} table`}><TableHeader><TableRow>{columns.map(column => <TableHead scope="col" key={column} className="px-5">{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={columns.length} className="px-5 py-6 text-muted-foreground">{emptyContent}</TableCell></TableRow> : rows.slice(current * 5, current * 5 + 5)}</TableBody></Table> : <div className="divide-y divide-border">{rows.slice(current * 5, current * 5 + 5)}</div>}
    {(last > 0 || olderHref || newestHref) ? <nav aria-label={`${label} pagination`} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
      <Button variant="outline" size="sm" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft aria-hidden="true" data-icon="inline-start" />Previous</Button>
      <span className="text-muted-foreground">Page {current + 1} of {last + 1}{olderHref ? "+" : ""}</span>
      {current === last && olderHref ? <Button asChild variant="outline" size="sm"><Link href={olderHref}>Older jobs<ChevronRight aria-hidden="true" data-icon="inline-end" /></Link></Button> : <Button variant="outline" size="sm" type="button" disabled={current === last} onClick={() => setPage(current + 1)}>Next<ChevronRight aria-hidden="true" data-icon="inline-end" /></Button>}
      {newestHref ? <Button asChild variant="ghost" size="sm"><Link href={newestHref}>Newest jobs</Link></Button> : null}
    </nav> : null}
  </>;
}
