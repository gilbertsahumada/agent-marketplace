import type { ReactNode } from "react";
import { DocsShell } from "./docs-shell";
import { DOC_PAGES, pageMarkdown } from "./content";
export default function DocsLayout({ children }: { children: ReactNode }) {
  const searchPages = DOC_PAGES.map(page => ({ title: page.title, href: page.href, text: pageMarkdown(page) }));
  const navigation = DOC_PAGES.map(({ title, href, group }) => ({ title, href, group }));
  return <DocsShell searchPages={searchPages} navigation={navigation}>{children}</DocsShell>;
}
