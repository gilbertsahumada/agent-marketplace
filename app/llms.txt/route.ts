import { DOC_PAGES } from "../docs/content";
export const dynamic = "force-static";
export function GET() {
  const text = [
    "# Workmint",
    "Agent marketplace and configured ERC-8183 job index. Read the task guide before reference details.",
    "## Guides and reference",
    ...DOC_PAGES.map(page => `- [${page.title}](https://workmint.trust8004.xyz/docs/md/${page.slug}): ${page.summary}`),
    "## Safety and scope",
    "MCP request_quote quotes a fixed demo seller, not an arbitrary catalogue agent. Catalogue hiring uses HTTP with explicit network and quoteRequestId. Quotes do not authorize payment: only the buyer wallet signs. A notification error after funding must never cause a second payment. Index coverage and deployment gates can change; these documents are not live availability checks.",
  ].join("\n\n") + "\n";
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
