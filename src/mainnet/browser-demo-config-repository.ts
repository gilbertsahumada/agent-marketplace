import type { MainnetDemoPublicConfig } from "../business/entities/mainnet-browser-demo.js";
import type { MainnetBrowserDemoConfigReader } from "../business/use-cases/get-mainnet-browser-demo-config.js";
import { loadMainnetBrowserDemoConfig } from "./browser-demo-config.js";

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
