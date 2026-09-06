import { expect, it, vi } from "vitest";
import { discoverNegotiationInput } from "../src/lib/seller-client";
const schema = { type: "object", required: ["task_description", "terms"], properties: {
  task_description: { type: "string" }, terms: { type: "object", required: ["deliverables", "quality_standards"], properties: { deliverables: { type: "string" }, quality_standards: { type: "string" } } },
} };
const spec = { openapi: "3.0.3", paths: { "/erc8183/negotiate": { post: { requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Request" } } } } } } }, components: { schemas: { Request: schema } } };
const input = (document: unknown) => ({ transport: "erc8183_http", endpoint: "https://seller.example.com/erc8183/status", request: {}, timeoutMs: 5000, maxResponseBytes: 32768, fetch: vi.fn(async url => Response.json(String(url).endsWith("/openapi.json") ? document : { status: "ok" })) });
it("does not describe an absent OpenAPI document as a failed seller connection", async () => {
  await expect(discoverNegotiationInput({ ...input(spec), fetch: vi.fn(async url => String(url).endsWith("/openapi.json") ? new Response(null, {status:404}) : Response.json({status:"ok"})) })).rejects.toThrow("NEGOTIATION_PARAMETERS_UNAVAILABLE");
});
it("discovers the exact HTTP negotiation body from same-origin OpenAPI without POST", async () => {
  const request = input(spec);
  const found = await discoverNegotiationInput(request);
  expect(found.encoding).toBe("request");
  expect(found.provenance).toMatchObject({ source: "openapi", detectorVersion: 2 });
  expect(request.fetch.mock.calls.map(([url]) => String(url))).toEqual(["https://seller.example.com/erc8183/status", "https://seller.example.com/openapi.json"]);
});
it.each([
  {},
  { ...spec, security: [{ apiKey: [] }] },
  { ...spec, servers: [{ url: "https://other.example.com" }] },
  { ...spec, components: { schemas: { Request: { $ref: "https://private.example/schema" } } } },
  { ...spec, components: { schemas: { Request: { $ref: "#/components/schemas/Request" } } } },
  { ...spec, components: { schemas: { Request: { ...schema, required: [...schema.required, "secret"], properties: { ...schema.properties, secret: { type: "string" } } } } } },
])("blocks incomplete, authenticated, unsafe or unsupported OpenAPI", async document => {
  await expect(discoverNegotiationInput(input(document))).rejects.toThrow();
});
