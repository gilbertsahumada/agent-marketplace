import type { NextConfig } from "next";

// Optional peers of connectors this app never constructs. The wagmi/connectors
// barrel imports them dynamically, so webpack resolves them at build time even
// though only injected() is configured.
const unusedWalletConnectors = [
  "@base-org/account",
  "@coinbase/wallet-sdk",
  "@gemini-wallet/core",
  "@metamask/sdk",
  "@safe-global/safe-apps-provider",
  "@safe-global/safe-apps-sdk",
  "@walletconnect/ethereum-provider",
  "porto",
  "porto/internal",
];

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unusedWalletConnectors.map((name) => [name, false])),
    };
    return config;
  },
};

export default nextConfig;
