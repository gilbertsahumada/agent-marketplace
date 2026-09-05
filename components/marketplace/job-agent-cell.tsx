import Link from "next/link";
import { IDENTITY_REGISTRIES, type AgentReference } from "@/shared/agent-identity";
import type { JobAgentResolution } from "@/src/business/entities/job-agent-resolution";

const LABELS: Record<JobAgentResolution["status"], string> = {
  registered: "Recorded association", wallet_match: "Wallet match · not historical proof",
  ambiguous: "Multiple candidates · not uniquely attributed", stale: "Wallet evidence out of date",
  unmatched: "No match in partial index", unavailable: "Identity lookup unavailable",
};

export function agentProfileHref(agent: AgentReference): string | null {
  return agent.profileAvailable && agent.chainId === 56
    && agent.registryAddress.toLowerCase() === IDENTITY_REGISTRIES[56]
    && /^[1-9]\d{0,19}$/.test(agent.agentId) ? `/agents/${agent.agentId}` : null;
}

/** Presentation only; shared by the table and job detail. */
export function JobAgentCell({ resolution }: { resolution?: JobAgentResolution | undefined }) {
  if (!resolution || !resolution.agents.length) {
    return <span className="text-xs text-muted-foreground">{LABELS[resolution?.status ?? "unavailable"]}</span>;
  }
  return <div className="flex min-w-40 max-w-64 flex-col gap-1 whitespace-normal">
    {resolution.agents.map(agent => {
      const href = agentProfileHref(agent);
      const label = agent.name?.trim() ? `${agent.name} · #${agent.agentId}` : `Agent #${agent.agentId}`;
      return <div key={`${agent.chainId}:${agent.registryAddress}:${agent.agentId}`}>
        {href ? <Link className="text-signal hover:underline" href={href}>{label}</Link> : <span>{label}</span>}
        {agent.chainId === 97 ? <span className="block text-xs text-muted-foreground">Testnet · profile not available</span> : null}
      </div>;
    })}
    <span className="text-xs text-muted-foreground">{LABELS[resolution.status]}</span>
  </div>;
}
