import type { MainnetDemoPublicConfig } from "../entities/mainnet-browser-demo.ts";

export interface MainnetBrowserDemoConfigReader {
  getPublicConfig(): MainnetDemoPublicConfig;
}

export class GetMainnetBrowserDemoConfig {
  constructor(private readonly reader: MainnetBrowserDemoConfigReader) {}
  execute(): MainnetDemoPublicConfig { return this.reader.getPublicConfig(); }
}
