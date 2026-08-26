import type { MainnetDemoPublicConfig } from "../business/entities/mainnet-browser-demo.ts";
import type { MainnetBrowserDemoConfigReader } from "../business/use-cases/get-mainnet-browser-demo-config.ts";
import { loadMainnetBrowserDemoConfig } from "./browser-demo-config.ts";

export class MainnetBrowserDemoConfigRepository implements MainnetBrowserDemoConfigReader {
  getPublicConfig(): MainnetDemoPublicConfig {
    const { deployment } = loadMainnetBrowserDemoConfig();
    return {
      agentId: deployment.agentId,
      seller: deployment.seller,
      commerce: deployment.commerce,
      router: deployment.router,
      policy: deployment.policy,
      token: deployment.token,
      maximumBudgetRaw: deployment.maximumBudgetRaw.toString(),
      rpcUrl: deployment.rpcUrl,
      explorerUrl: deployment.explorerUrl,
    };
  }
}
