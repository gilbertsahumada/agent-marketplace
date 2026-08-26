// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletConnectButton } from "../components/marketplace/wallet-connect-button.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";

const account = vi.fn();
const chainId = vi.fn();
const switchChain = vi.fn();
const connect = vi.fn();
const disconnect = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => account(),
  useChainId: () => chainId(),
  useConnect: () => ({ connect, connectors: [{ id: "injected", name: "Injected" }], error: null }),
  useDisconnect: () => ({ disconnect }),
  useSwitchChain: () => ({ switchChain }),
}));

const BUYER = "0x5ee75a1B1648C023e885E58bD3735Ae273f2cc52";

function renderButton() {
  return render(
    createElement(TooltipProvider, { children: createElement(WalletConnectButton) }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("header wallet connect button", () => {
  it("invites the visitor to connect when no wallet is attached", async () => {
    account.mockReturnValue({ address: undefined, isConnected: false, connector: undefined });
    chainId.mockReturnValue(56);
    renderButton();
    expect(await screen.findByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    const result = await axe.run(document.body);
    expect(result.violations).toEqual([]);
  });

  it("shows the truncated address once a wallet is connected on BSC", async () => {
    account.mockReturnValue({ address: BUYER, isConnected: true, connector: {} });
    chainId.mockReturnValue(56);
    renderButton();
    expect(await screen.findByRole("button", { name: /0x5ee7…cc52/i })).toBeInTheDocument();
    expect(screen.queryByText(BUYER)).not.toBeInTheDocument();
  });

  it("reports an unsupported chain without switching it automatically", async () => {
    account.mockReturnValue({ address: BUYER, isConnected: true, connector: {} });
    chainId.mockReturnValue(1);
    renderButton();
    expect(await screen.findByRole("button", { name: /wrong network/i })).toBeInTheDocument();
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("offers both BSC networks and switches only when one is chosen", async () => {
    const user = userEvent.setup();
    account.mockReturnValue({ address: BUYER, isConnected: true, connector: {} });
    chainId.mockReturnValue(1);
    renderButton();
    await user.click(await screen.findByRole("button", { name: /wrong network/i }));
    await user.click(screen.getByRole("button", { name: /bsc testnet/i }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 97 });
  });

  it("disconnects on request", async () => {
    const user = userEvent.setup();
    account.mockReturnValue({ address: BUYER, isConnected: true, connector: {} });
    chainId.mockReturnValue(56);
    renderButton();
    await user.click(await screen.findByRole("button", { name: /0x5ee7…cc52/i }));
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalled();
  });
});
