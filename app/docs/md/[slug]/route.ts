import { DOCS_MARKDOWN } from "../../markdown";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const markdown = DOCS_MARKDOWN[slug];
  if (!markdown) {
    return Response.json({ error: { code: "DOCS_PAGE_NOT_FOUND", message: "Unknown documentation page." } }, { status: 404 });
  }
  return new Response(markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
