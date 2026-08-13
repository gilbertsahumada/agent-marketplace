import {
  EVMWalletProvider,
  type WalletProvider,
} from "@bnbagent/sdk/wallets";
import { getAddress, type Address } from "viem";

export interface BuyerWalletSettings {
  address: Address;
  password: string | null;
  walletsDir?: string;
}

export type BuyerWalletFactory = (
  settings: BuyerWalletSettings,
) => WalletProvider;

export const createEvmBuyerWallet: BuyerWalletFactory = (
  settings,
): WalletProvider => {
  if (!settings.password) {
    throw new Error(
      "BUYER_WALLET_PASSWORD is required through an external secret mechanism",
    );
  }
  if (
    !EVMWalletProvider.keystoreExists(settings.address, settings.walletsDir)
  ) {
    throw new Error(
      `No existing encrypted buyer keystore found for ${settings.address}; wallet creation is outside Gate 1`,
    );
  }
  const wallet = new EVMWalletProvider({
    password: settings.password,
    address: settings.address,
    ...(settings.walletsDir ? { walletsDir: settings.walletsDir } : {}),
  });
  if (getAddress(wallet.address) !== settings.address) {
    throw new Error("Loaded buyer keystore does not match BUYER_ADDRESS");
  }
  return wallet;
};
