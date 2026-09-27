import { Fragment } from "react";
import Link from "next/link";
import { DOC_PAGES, pageMarkdown, type DocBlock } from "./content";
import { Callout, CodeBlock, DocsSection, InlineCode } from "./components";
import { PageActions } from "./page-actions";
import { cn } from "@/lib/utils";

function Inline({ text }: { text: string }) {
  return text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return <Link key={i} prefetch={false} href={link[2]!} className="text-foreground underline decoration-primary/40 underline-offset-4 hover:text-primary">{link[1]}</Link>;
    if (part.startsWith("`") && part.endsWith("`")) return <InlineCode key={i}>{part.slice(1, -1)}</InlineCode>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "text": return <p><Inline text={block.value} /></p>;
    case "note": return <Callout tone={block.warning ? "warning" : "note"}><p><Inline text={block.value} /></p></Callout>;
    case "code": return <CodeBlock title={block.title} lang={block.lang}>{block.value}</CodeBlock>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return <Tag className={cn("flex flex-col gap-2 pl-5", block.ordered ? "list-decimal" : "list-disc")}>{block.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</Tag>;
    }
    case "table": return <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={block.headers.join(" / ")}><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-muted/30">{block.headers.map(h => <th key={h} scope="col" className="px-4 py-3 font-medium text-foreground">{h}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i} className="border-b border-border last:border-0">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top"><Inline text={cell} /></td>)}</tr>)}</tbody></table></div>;
  }
}

export function DocumentationPage({ slug }: { slug: string }) {
  const page = DOC_PAGES.find(candidate => candidate.slug === slug);
  if (!page) throw new Error(`Unknown documentation page: ${slug}`);
  return <div className="flex flex-col gap-10">
    <header>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 text-3xl font-semibold tracking-tight">{page.title}</h1>
        <div className="ml-auto shrink-0"><PageActions slug={page.slug} markdown={pageMarkdown(page)} /></div>
      </div>
      <p className="mt-3 text-muted-foreground"><Inline text={page.summary} /></p>
    </header>
    {page.sections.map(section => <div key={section.id} className="relative">
      {section.aliases?.map(alias => <span key={alias} id={alias} className="absolute top-0 scroll-mt-24" aria-hidden="true" />)}
      <DocsSection id={section.id} title={section.title}>{section.blocks.map((block, i) => <Block key={i} block={block} />)}</DocsSection>
    </div>)}
  </div>;
}
