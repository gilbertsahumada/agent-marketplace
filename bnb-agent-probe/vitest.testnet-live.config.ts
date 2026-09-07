import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Explicit opt-in command only. Isolated emulator database; no remote D1.
export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")) },
      outboundService: async request => {
        const url = new URL(request.url);
        const forward = async () => fetch(request.url, {
          method: request.method, headers: Object.fromEntries(request.headers),
          ...(request.method === "POST" ? { body: await request.text() } : {}),
        });
        if (url.protocol !== "https:") return new Response(null, { status: 403 });
        if (request.method === "GET" && (url.hostname === "trust8004.xyz" || url.hostname === "healthfactoragg.ammlabs.fun")) return forward();
        if (request.method === "POST") {
          const data = await request.clone().json() as { method?: string; params?: { message?: { parts?: Array<{ data?: { skill?: string } }> } } };
          if (url.hostname === "data-seed-prebsc-2-s2.binance.org" && ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_call", "eth_getCode"].includes(data.method ?? "")) return forward();
          if (url.hostname === "healthfactoragg.ammlabs.fun" && data.method === "message/send"
            && data.params?.message?.parts?.[0]?.data?.skill === "negotiate") return forward();
        }
        return new Response("Live test egress denied", { status: 403 });
      },
    },
  }))],
  test: { include: ["test/live/testnet-quote.live.ts"], setupFiles: ["./test/integration/apply-migrations.ts"], testTimeout: 60000 },
});
