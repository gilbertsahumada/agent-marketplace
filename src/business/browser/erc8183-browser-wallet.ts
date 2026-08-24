// Client composition seam: presentation depends on Business, which selects
// the one Gate 6A browser adapter implemented by Data/Infrastructure.
export {
  clearBrowserJournal,
  connectInjectedWallet,
  executeBrowserHire,
  loadBrowserJournal,
  saveBrowserJournal,
} from "../../data/erc8183/browser-wallet-adapter.js";
export type { Erc8183BrowserDeployment } from "../../data/erc8183/browser-wallet-adapter.js";
export { ERC8183_TESTNET } from "../../data/erc8183/contracts.js";
