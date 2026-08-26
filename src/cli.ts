#!/usr/bin/env node
import { loadConfig, loadReceiptConfig, parseArgs } from "./config.ts";
import { execute, resume, runPreflight } from "./flow.ts";

function print(value: unknown): void {
  console.log(
    JSON.stringify(
      value,
      (_key, item) => (typeof item === "bigint" ? item.toString() : item),
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "resume") {
    print(
      await resume(loadReceiptConfig(process.env), BigInt(args.jobId!)),
    );
    return;
  }
  const config = loadConfig(process.env, args.agentId);

  if (args.command === "preflight" || !args.execute) {
    const result = await runPreflight(config);
    print({
      ok: true,
      mode: "preflight",
      agentId: result.identity.agentId,
      endpoint: result.identity.a2aEndpoint,
      provider: result.provider,
      quote: {
        price: result.price.toString(),
        token: result.token,
        symbol: result.tokenSymbol,
      },
      balances: {
        token: result.buyerBalance?.toString() ?? null,
        native: result.buyerNativeBalance?.toString() ?? null,
      },
      intent: result.intent,
      next: "Run again with: run --agent-id <id> --execute",
    });
    return;
  }

  print(await execute(config));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
