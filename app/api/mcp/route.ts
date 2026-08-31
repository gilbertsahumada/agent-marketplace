import { handleMarketplaceMcpRequest } from "@/src/marketplace-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMarketplaceMcpRequest(request);
}

function methodNotAllowed() {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. The marketplace MCP endpoint is stateless: POST JSON-RPC messages only." },
      id: null,
    },
    { status: 405, headers: { allow: "POST" } },
  );
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
