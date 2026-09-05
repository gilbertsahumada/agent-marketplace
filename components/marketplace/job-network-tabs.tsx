"use client";
import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function JobNetworkTabs({ agentId, chainId, children, walletScope, onNetworkChange, pending: externalPending }: { agentId: string; chainId: 56 | 97; children: ReactNode; walletScope: boolean; onNetworkChange?: ((network: string) => void) | undefined; pending?: boolean | undefined }) {
  const router = useRouter();
  const [navigationPending, startTransition] = useTransition();
  const pending = externalPending ?? navigationPending;
  const value = chainId === 56 ? "mainnet" : "testnet";
  return <Tabs value={value} onValueChange={network => onNetworkChange ? onNetworkChange(network) : startTransition(() => router.push(`/hire/${agentId}?jobsNetwork=${network}#erc8183-history`, { scroll: false }))} aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-4 px-5 pt-3">
      <TabsList variant="line" aria-label="Job history network">
        <TabsTrigger value="mainnet" disabled={pending}>Mainnet</TabsTrigger>
        <TabsTrigger value="testnet" disabled={pending}>Testnet</TabsTrigger>
      </TabsList>
      {walletScope ? <span className="text-xs text-muted-foreground">Wallet activity · not exclusive to this agent</span> : null}
      <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">{pending ? <><LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />Loading jobs…</> : null}</span>
    </div>
    <TabsContent value={value}>{children}</TabsContent>
  </Tabs>;
}
