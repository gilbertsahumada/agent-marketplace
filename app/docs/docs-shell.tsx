"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Search, Menu, List, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { DocsNav, type DocsNavItem } from "./docs-nav";

export type SearchPage = { title: string; href: string; text: string };
export function DocsShell({ children, searchPages, navigation }: { children: ReactNode; searchPages: SearchPage[]; navigation: DocsNavItem[] }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [headings, setHeadings] = useState<{ id: string; title: string }[]>([]);
  const [active, setActive] = useState("");
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    setMenuOpen(false); setSearchOpen(false);
    const elements = Array.from(article.current?.querySelectorAll<HTMLHeadingElement>("h2[id]") ?? []);
    setHeadings(elements.map((element) => ({ id: element.id, title: element.textContent ?? "" })));
    setActive(elements[0]?.id ?? "");
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-120px 0px -60% 0px" });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((open) => !open); } };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = searchPages.filter((page) => words.every((word) => `${page.title} ${page.text}`.toLowerCase().includes(word)));
  return <div className="docs-shell mx-auto w-full max-w-[1480px] flex-1 px-5 sm:px-8 lg:px-12">
    <div className="grid min-w-0 gap-8 py-8 md:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_175px] xl:gap-12">
      <aside aria-label="Documentation sidebar" className="min-w-0 self-start md:sticky md:top-24">
        <div className="mb-6 flex items-center gap-2">
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}><DialogTrigger asChild><Button variant="ghost" className="md:hidden"><Menu data-icon="inline-start" />Guides</Button></DialogTrigger><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogTitle>Documentation</DialogTitle><DialogDescription>Guides and API reference</DialogDescription><DocsNav items={navigation} onNavigate={() => setMenuOpen(false)} /></DialogContent></Dialog>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogTrigger asChild><Button variant="outline" aria-label="Search documentation" title="Search documentation (⌘ / Ctrl K)" className="h-10 w-full min-w-0 flex-1 justify-start gap-2 px-3"><Search data-icon="inline-start" /><span className="truncate">Search docs</span></Button></DialogTrigger><DialogContent className="sm:max-w-xl"><DialogTitle>Search documentation</DialogTitle><DialogDescription>Search the guides locally. No API requests are made.</DialogDescription><Input aria-label="Search documentation" placeholder="Jobs, quotes, pagination…" value={query} onChange={(event) => setQuery(event.target.value)} /><div aria-live="polite" className="max-h-[50dvh] overflow-y-auto"><p className="mb-2 text-xs text-muted-foreground">{results.length} matching guides</p>{results.map((page) => <Link key={page.href} href={page.href} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted"><FileText className="size-4 text-primary" aria-hidden="true" /><span>{page.title}</span></Link>)}{results.length === 0 && <p className="py-5 text-sm text-muted-foreground">No matching guide. Try “jobs”, “MCP” or “quotes”.</p>}</div></DialogContent></Dialog>
        </div>
        <div className="hidden md:block"><DocsNav items={navigation} /></div>
      </aside>
      <main ref={article} id="main-content" className="docs-article min-w-0 w-full max-w-[760px] pb-16">{children}</main>
      <aside className="sticky top-24 hidden max-h-[calc(100dvh-120px)] overflow-y-auto self-start xl:block"><nav aria-label="On this page"><p className="mb-4 flex items-center gap-2 text-xs font-medium"><List className="size-4" aria-hidden="true" />On this page</p><div className="flex flex-col border-l border-border">{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} aria-current={active === heading.id ? "location" : undefined} className="docs-toc-link -ml-px border-l border-transparent px-4 py-2 text-xs leading-relaxed text-muted-foreground hover:text-foreground">{heading.title}</a>)}</div></nav></aside>
    </div>
  </div>;
}
