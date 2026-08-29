import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (url.hostname !== "trust8004.xyz" || !url.pathname.endsWith("/agents")) {
            return new Response(null, { status: 404 });
          }
          return Response.json({
            items: [],
            total: 0,
            limit: Number(url.searchParams.get("limit")),
            offset: Number(url.searchParams.get("offset")),
          });
        },
      },
    })),
  ],
  test: {
    globals: true,
    testTimeout: 10_000,
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/integration/apply-migrations.ts"],
  },
});
