// Client composition seam: presentation depends on Business, which selects
// the one Gate 6A browser adapter implemented by Data/Infrastructure.
export {
  clearBrowserJournal,
  connectInjectedWallet,
  detectBrowserHireMode,
  executeBrowserHire,
  loadBrowserJournal,
  normalizeBrowserAddress,
  recoverBrowserJournal,
  recoverFundedBrowserJournal,
  saveBrowserJournal,
} from "../../data/erc8183/browser-wallet-adapter.ts";
export type { BrowserHireMode, Erc8183BrowserDeployment } from "../../data/erc8183/browser-wallet-adapter.ts";
export { ERC8183_TESTNET } from "../../data/erc8183/contracts.ts";
export { ERC8183_MAINNET } from "../../mainnet/contracts.ts";
