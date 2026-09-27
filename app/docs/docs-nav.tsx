"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Blocks, Braces, Bot, Wallet, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
export interface DocsNavItem { title: string; href: string; group: string }
const icons = [BookOpen, Wallet, Plug, Blocks, Braces, Bot];
export function DocsNav({ items, onNavigate = () => {} }: { items: DocsNavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Documentation" className="docs-navigation flex flex-col gap-7">{[...new Set(items.map(item => item.group))].map(group => <div key={group}><p className="mb-2 px-3 text-xs font-medium text-foreground">{group}</p><div className="flex flex-col gap-1">{items.filter(item => item.group === group).map(item => {
    const Icon = icons[items.indexOf(item)] ?? BookOpen;
    return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={pathname === item.href ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors", pathname === item.href ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="size-4 shrink-0" aria-hidden="true" />{item.title}</Link>;
  })}</div></div>)}</nav>;
}
