import type { ReactNode } from "react";
import { DocsNav } from "./docs-nav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="gap-10 lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="mb-8 lg:sticky lg:top-24 lg:mb-0 lg:self-start">
          <p className="font-eyebrow mb-3 hidden text-zinc-500 lg:block">Documentation</p>
          <DocsNav />
        </aside>
        <main className="min-w-0 max-w-3xl" id="main-content">{children}</main>
      </div>
    </div>
  );
}
