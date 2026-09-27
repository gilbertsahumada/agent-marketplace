import { DOC_PAGES, pageMarkdown } from "./content";
// Compatibility export used by existing consumers. Content is authored only once.
export const DOCS_MARKDOWN: Record<string, string> = Object.fromEntries(DOC_PAGES.map(page => [page.slug, pageMarkdown(page)]));
