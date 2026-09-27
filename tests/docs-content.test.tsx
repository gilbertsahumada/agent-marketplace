// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOC_PAGES, pageMarkdown } from "../app/docs/content";
import { DocumentationPage } from "../app/docs/documentation-page";
import { DOCS_MARKDOWN } from "../app/docs/markdown";
import { marketplaceMcpTools } from "../src/marketplace-mcp";
import { MCP_TOOL_METADATA } from "../src/marketplace-mcp-metadata";
import { GET } from "../app/docs/md/[slug]/route";
import { GET as llmsIndex } from "../app/llms.txt/route";

describe("canonical documentation", () => {
  it("indexes every guide for agents and resolves internal documentation anchors", async () => {
    const index = await llmsIndex().text();
    for (const page of DOC_PAGES) {
      expect(index).toContain(`/docs/md/${page.slug}`);
      for (const match of pageMarkdown(page).matchAll(/\]\(https:\/\/workmint\.trust8004\.xyz(\/docs[^)]*)\)/g)) {
        const [path, anchor] = match[1]!.split("#");
        const target = DOC_PAGES.find(candidate => candidate.href === path);
        expect(target, match[1]).toBeDefined();
        if (anchor) expect(target!.sections.flatMap(section => [section.id, ...(section.aliases ?? [])])).toContain(anchor);
      }
    }
  });
  it("exports every page to Markdown without a second authored version", async () => {
    for (const page of DOC_PAGES) {
      expect(DOCS_MARKDOWN[page.slug]).toBe(pageMarkdown(page));
      expect(DOCS_MARKDOWN[page.slug]!.length).toBeGreaterThan(200);
      const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: page.slug }) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(pageMarkdown(page));
      const html = renderToStaticMarkup(<DocumentationPage slug={page.slug} />);
      for (const section of page.sections) expect(html).toContain(`id="${section.id}"`);
      for (const section of page.sections) for (const block of section.blocks) {
        if (block.type === "code" && block.lang === "json") expect(() => JSON.parse(block.value)).not.toThrow();
      }
    }
  });
  it("includes sellers and indexed jobs, with safe recovery and demo boundaries", () => {
    expect(DOCS_MARKDOWN.sellers).toContain("capabilityProbeParameters");
    expect(DOCS_MARKDOWN.jobs).toContain("nextBefore");
    expect(DOCS_MARKDOWN.hire).toContain("NOTIFICATION_PENDING");
    expect(DOCS_MARKDOWN.hire).toContain("Do not fund again");
    expect(DOCS_MARKDOWN.hire).toContain("quoteRequestId");
    expect(DOCS_MARKDOWN.mcp).toContain("fixed demo");
  });
  it("keeps public MCP metadata identical to the documented source", () => {
    expect(marketplaceMcpTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).toEqual(MCP_TOOL_METADATA);
    for (const tool of MCP_TOOL_METADATA) expect(DOCS_MARKDOWN.mcp).toContain(tool.name);
  });
  it("retains unknown Markdown page errors", async () => {
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "missing" }) })).status).toBe(404);
  });
});
