import type { ReactNode } from "react";
import { ArrowRight, Info, TriangleAlert } from "lucide-react";
import { CopyButton } from "./copy-button";
import { highlightJson } from "./highlight";

export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <h2 className="border-b border-white/10 pb-2 text-xl font-semibold tracking-tight text-white" id={id}>
        <a className="hover:text-primary" href={`#${id}`}>{title}</a>
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

export function SubHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 className="scroll-mt-24 pt-2 text-base font-semibold text-zinc-100" id={id}>
      <a className="hover:text-primary" href={`#${id}`}>{children}</a>
    </h3>
  );
}

export function CodeBlock({ title, lang, children }: { title?: string; lang?: "json"; children: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-white/10 bg-zinc-950">
      <figcaption className="flex items-center justify-between gap-2 border-b border-white/[0.06] py-1 pl-3 pr-1.5">
        <span className="font-mono text-[11px] text-zinc-500">{title ?? (lang === "json" ? "json" : "")}</span>
        <CopyButton text={children} />
      </figcaption>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-zinc-200">
        <code>{lang === "json" ? highlightJson(children) : children}</code>
      </pre>
    </figure>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-zinc-200">{children}</code>;
}

export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export function ParamTable({ rows }: { rows: ParamRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-zinc-500">
            <th className="px-3 py-2 font-medium">Parameter</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Required</th>
            <th className="px-3 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-white/[0.06] last:border-b-0" key={row.name}>
              <td className="px-3 py-2 font-mono text-zinc-200">{row.name}</td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{row.type}</td>
              <td className="px-3 py-2 text-zinc-400">{row.required ? "yes" : "no"}</td>
              <td className="px-3 py-2 text-zinc-400">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ tone, children }: { tone: "note" | "warning"; children: ReactNode }) {
  const warning = tone === "warning";
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3 text-sm leading-relaxed ${
        warning ? "border-amber-400/20 bg-amber-400/[0.05] text-amber-100/90" : "border-sky-400/20 bg-sky-400/[0.05] text-sky-100/90"
      }`}
    >
      {warning
        ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
        : <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky-300" />}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div className="flex items-center gap-2" key={step}>
          {index > 0 ? <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-zinc-600" /> : null}
          <span className="rounded-lg border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200">{step}</span>
        </div>
      ))}
    </div>
  );
}

export function ExternalDocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white" href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}
