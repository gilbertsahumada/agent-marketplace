"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ERC8183_MAINNET } from "@/src/mainnet/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { markCatalogForRefresh } from "@/components/marketplace/catalog-return-refresh";
import { WalletConnectButton } from "@/components/marketplace/wallet-connect-button";
import { relativeAge } from "@/components/marketplace/relative-time";
import {
  type Erc8183BrowserJournal,
  type Erc8183HirePlan,
  type Erc8183JobFacts,
  type Erc8183TransactionIntent,
  type NormalizedErc8183Quote,
  type NotifyFundedResult,
} from "@/src/business/entities/erc8183-browser-spike";
import type { MainnetDemoPublicConfig } from "@/src/business/entities/mainnet-browser-demo";
import {
  detectBrowserHireMode,
  executeBrowserHire,
  loadBrowserJournal,
  normalizeBrowserAddress,
  recoverFundedBrowserJournal,
  saveBrowserJournal,
  ERC8183_TESTNET,
  type BrowserHireMode,
  type Erc8183BrowserDeployment,
} from "@/src/business/browser/erc8183-browser-wallet";

type ApiError = { error?: { code?: string; message?: string } };
export type MainnetQuoteResponse = NormalizedErc8183Quote & {
  maximumBudgetRaw?: string;
  observationId?: number | null;
  observationSync?: { status: "synced" | "duplicate" | "failed" | "not_configured" };
};

export function sharedEvidenceSyncMessage(status: MainnetQuoteResponse["observationSync"]): string {
  return status?.status === "synced" || status?.status === "duplicate"
    ? "Shared evidence updated"
    : "Quote verified for this session. Shared evidence sync pending.";
}

// Shown before the first signature of a fresh hire. `null` until the wallet
// has been asked (EIP-5792 capabilities), so the copy never guesses.
export function hireConfirmationLabel(mode: BrowserHireMode | null, requiredTransactions: number): string | null {
  if (mode === "batched") return "One wallet confirmation";
  if (mode === "sequential") return `${requiredTransactions} wallet confirmations`;
  return null;
}

function busyStatusLabel(busy: string | null): string | null {
  if (busy === "Requesting a signed quote") return "Requesting a fresh seller quote";
  if (busy === "Preparing the connected wallet") return "Reading wallet balances and preparing the hire";
  if (busy === "Waiting for wallet confirmations") return "Waiting for the wallet to confirm the requested transactions";
  if (busy === "Recovering confirmed job") return "Reading the confirmed job from the chain";
  if (busy === "Notifying seller") return "Payment confirmed · notifying seller";
  return null;
}

type InjectedProvider = Parameters<typeof executeBrowserHire>[0];

async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "The chain request failed.");
  }
  return body;
}

type HireEventReport =
  | { phase: "clicked" }
  | { phase: "created" | "funded" | "submitted"; jobId: string; txHash: string };

// Best-effort beacon: the same-origin route sanitizes and forwards the event,
// and the Worker verifies chain phases by RPC. Nothing here waits on it or
// claims the shared index was updated, and it survives the job-page redirect.
function reportHireEvent(deployment: Erc8183BrowserDeployment, event: HireEventReport, options: { quoteRequestId?: number | null } = {}): void {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
  const body = JSON.stringify({
    agentId: String(deployment.agentId),
    chainId: deployment.chainId,
    phase: event.phase,
    jobId: event.phase === "clicked" ? null : event.jobId,
    txHash: event.phase === "clicked" ? null : event.txHash,
    ...(event.phase === "clicked" || options.quoteRequestId === undefined || options.quoteRequestId === null
      ? {}
      : { quoteRequestId: options.quoteRequestId }),
  });
  try {
    navigator.sendBeacon("/api/marketplace/hire-events", new Blob([body], { type: "application/json" }));
  } catch {
    // Telemetry never interrupts the hire.
  }
}

function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function displayUnits(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function EvidenceStep({ label, state }: { label: string; state: "pending" | "current" | "verified" }) {
  return (
    <li className="flex items-center gap-2 text-xs text-zinc-400">
      {state === "verified" ? (
        <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-400" />
      ) : state === "current" ? (
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-amber-300 bg-amber-300/20" />
      ) : (
        <span aria-hidden="true" className="size-3 rounded-full border border-zinc-600" />
      )}
      <span className={state === "current" ? "text-amber-100" : state === "verified" ? "text-zinc-200" : ""}>
        {label} <span className="sr-only">— {state}</span>
      </span>
    </li>
  );
}

function SummaryRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-white/[0.06] py-3 last:border-0 sm:grid-cols-[11rem_1fr]">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={mono ? "font-hash text-xs text-zinc-200" : "text-sm text-zinc-200"}>{value}</dd>
    </div>
  );
}

function CheckoutSummaryRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 border-b border-white/[0.06] py-3 last:border-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`${mono ? "font-hash text-xs" : "text-sm"} min-w-0 text-right text-zinc-200`}>{value}</dd>
    </div>
  );
}

function ChainReference({
  explorerUrl,
  kind,
  label,
  value,
}: {
  explorerUrl: string;
  kind: "address" | "transaction";
  label?: string;
  value: string;
}) {
  const href = `${explorerUrl}/${kind === "transaction" ? "tx" : "address"}/${value}`;
  return (
    <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
      <a
        aria-label={`View ${label ? `${label} ` : ""}${kind} ${value} in explorer`}
        className="font-hash truncate text-xs text-zinc-200 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
        href={href}
        rel="noreferrer"
        target="_blank"
        title={value}
      >
        {shortAddress(value)}
      </a>
      <button
        aria-label={`Copy ${kind} ${value}`}
        className="cursor-pointer rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => void navigator.clipboard?.writeText(value)}
        type="button"
      >
        <Copy aria-hidden="true" className="size-3.5" />
      </button>
      <ExternalLink aria-hidden="true" className="size-3 text-zinc-500" />
    </span>
  );
}

function CheckoutStep({
  children,
  label,
  number,
  state,
}: {
  children?: ReactNode;
  label: string;
  number: number;
  state: "complete" | "current" | "locked";
}) {
  return (
    <li aria-current={state === "current" ? "step" : undefined} className="relative border-b border-white/[0.08] last:border-0" data-checkout-step={state}>
      <span aria-hidden="true" className={`absolute bottom-0 left-[1.95rem] top-12 w-px sm:left-[2.2rem] ${state === "complete" ? "bg-emerald-400/60" : state === "current" ? "bg-primary/60" : "bg-white/10"}`} />
      <div className="relative flex min-h-16 items-center gap-3 px-4 sm:px-5">
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium ${state === "complete"
            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
            : state === "current"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-zinc-700 text-zinc-500"}`}
        >
          {state === "complete" ? <CheckCircle2 className="size-4" /> : number}
        </span>
        <span className={state === "locked" ? "text-sm font-medium text-zinc-500" : "text-sm font-medium text-zinc-100"}>{label}</span>
        {state === "locked" ? <span className="ml-auto text-xs text-zinc-600">Locked</span> : null}
      </div>
      {state === "current" && children ? <div className="px-4 pb-5 pl-15 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 sm:px-5 sm:pb-6 sm:pl-16">{children}</div> : null}
    </li>
  );
}

export function Erc8183TransactionList({
  explorerUrl,
  intents,
  journal,
  mode = null,
  restored = false,
}: {
  explorerUrl: string;
  intents: Erc8183TransactionIntent[];
  journal: Erc8183BrowserJournal | null;
  mode?: BrowserHireMode | null;
  /** True when the rows came from the browser's persisted progress journal. */
  restored?: boolean;
}) {
  const executionNote = restored
    ? "Progress was restored from this browser. A confirmed row has a recorded receipt; the current job read and explorer remain authoritative."
    : mode === "batched"
    ? "Your wallet can submit these calls as one atomic confirmation. Each row is marked confirmed only after its chain receipt is verified."
    : mode === "sequential"
      ? "Your wallet will ask for each required call in order. A row is sent only after you approve it, and confirmed only after its chain receipt is verified."
      : "These are the exact calls the wallet may execute. Nothing is sent while you review this list; the wallet action below starts the request.";

  return (
    <div>
      <p className="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-zinc-400" data-transaction-plan-note>
        {executionNote}
      </p>
      <ol className="space-y-3" aria-label="Planned wallet transactions">
      {intents.map((intent) => {
        const hash = journal?.transactions[intent.kind];
        const confirmed = journal?.receipts?.[intent.kind] !== undefined;
        const state = confirmed ? "confirmed" : hash ? "submitted" : intent.required ? "not_sent" : "not_required";
        const stateConfig = {
          confirmed: {
            label: "Confirmed onchain",
            className: "border-emerald-400/30 text-emerald-300",
            icon: CheckCircle2,
          },
          submitted: {
            label: "Sent · awaiting confirmation",
            className: "border-cyan-400/30 text-cyan-200",
            icon: Clock3,
          },
          not_sent: {
            label: "Not sent",
            className: "border-amber-400/30 text-amber-200",
            icon: CircleDashed,
          },
          not_required: {
            label: "Not required",
            className: "border-zinc-700 text-zinc-500",
            icon: CircleDashed,
          },
        }[state];
        const StateIcon = stateConfig.icon;
        return (
          <li key={intent.kind} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3" data-transaction-state={state}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-hash text-xs text-zinc-200">{intent.kind}</p>
                <p className="mt-1 text-xs text-zinc-500">{intent.purpose}</p>
                <div className="mt-2 flex justify-start">
                  <ChainReference explorerUrl={explorerUrl} kind="address" label={`${intent.kind} contract`} value={intent.contract} />
                </div>
              </div>
              <Badge className={stateConfig.className} variant="outline">
                <StateIcon aria-hidden="true" className="size-3" />
                {stateConfig.label}
              </Badge>
            </div>
            {hash && (
              <div className="mt-3 flex justify-start"><ChainReference explorerUrl={explorerUrl} kind="transaction" label={intent.kind} value={hash} /></div>
            )}
          </li>
        );
      })}
      </ol>
    </div>
  );
}

const TESTNET_DEPLOYMENT: Erc8183BrowserDeployment = {
  ...ERC8183_TESTNET,
  nativeCurrencyName: "tBNB",
  nativeCurrencySymbol: "tBNB",
};

export interface EmbeddedHireEvidence {
  protocol: string;
  endpoint: string;
  reachable: boolean;
  quoteStatus?: "not_supported" | "not_requested" | "verified_fresh" | "verified_historical" | "rejected";
  lastCheckedAt?: string;
  attemptCount?: number;
  httpStatus?: number;
  durationMs?: number;
}

export function Erc8183MainnetDemo({ config, agentName, embedded = false, evidence }: {
  config: MainnetDemoPublicConfig;
  agentName?: string;
  embedded?: boolean;
  evidence?: EmbeddedHireEvidence;
}) {
  return <Erc8183BrowserDemo mode="mainnet" deployment={{
    chainId: 56,
    networkName: "BNB Smart Chain",
    nativeCurrencyName: "BNB",
    nativeCurrencySymbol: "BNB",
    ...config,
    maximumBudgetRaw: BigInt(config.maximumBudgetRaw),
  }} {...(agentName ? { agentName } : {})} embedded={embedded} {...(evidence ? { evidence } : {})} />;
}

/**
 * The catalog path uses the same audited browser wallet and stepper as the
 * legacy demo, but receives its deployment from the verified seller quote.
 * This keeps every compatible seller on one hire experience.
 */
export function Erc8183MarketplaceHire({
  agentName,
  onQuoteExpired,
  quote,
  quoteRequestId,
}: {
  agentName?: string;
  onQuoteExpired?: () => void;
  quote: MainnetQuoteResponse;
  quoteRequestId: number;
}) {
  const deployment: Erc8183BrowserDeployment = {
    chainId: 56,
    networkName: ERC8183_MAINNET.networkName,
    nativeCurrencyName: "BNB",
    nativeCurrencySymbol: "BNB",
    rpcUrl: ERC8183_MAINNET.rpcUrl,
    explorerUrl: ERC8183_MAINNET.explorerUrl,
    agentId: quote.agentId,
    commerce: quote.commerce,
    router: quote.router,
    policy: quote.policy,
    token: quote.token,
    seller: quote.provider,
    maximumBudgetRaw: BigInt(quote.priceRaw),
  };
  return (
    <Erc8183BrowserDemo
      {...(agentName ? { agentName } : {})}
      apiBaseOverride={`/api/marketplace/agents/${quote.agentId}/hire`}
      deployment={deployment}
      embedded
      initialQuote={quote}
      jobsBaseOverride={`/api/marketplace/agents/${quote.agentId}/hire/jobs`}
      mode="mainnet"
      {...(onQuoteExpired ? { onQuoteExpired } : {})}
      quoteRequestId={quoteRequestId}
    />
  );
}

export function Erc8183TestnetDemo() {
  return <Erc8183BrowserDemo mode="testnet" deployment={TESTNET_DEPLOYMENT} />;
}

/** Only reads a saved execution reference; never requests a fresh quote or prepares payment. */
export function Erc8183SavedHire({ agentId, onActiveChange }: { agentId: string; onActiveChange?: (active: boolean) => void }) {
  const [deployment, setDeployment] = useState<Erc8183BrowserDeployment | null>(null);
  useEffect(() => {
    setDeployment(null);
    try {
      const raw = localStorage.getItem(`bnb-agent-marketplace:erc8183-browser:56:${agentId}:v1`);
      if (!raw || !/^\d+$/.test(agentId)) return;
      const reference = JSON.parse(raw) as { seller?: string };
      if (!reference.seller) return;
      const candidate: Erc8183BrowserDeployment = {
        ...ERC8183_MAINNET, agentId: Number(agentId), seller: normalizeBrowserAddress(reference.seller),
        nativeCurrencyName: "BNB", nativeCurrencySymbol: "BNB", maximumBudgetRaw: (2n ** 256n) - 1n,
      };
      if (loadBrowserJournal(localStorage, candidate)?.jobId) setDeployment(candidate);
    } catch { /* An unreadable local reference never becomes an active hire. */ }
  }, [agentId]);
  return deployment ? <Erc8183BrowserDemo deployment={deployment} mode="mainnet" embedded recoveryOnly
    {...(onActiveChange ? { onRecoveryActiveChange: onActiveChange } : {})}
    apiBaseOverride={`/api/marketplace/agents/${agentId}/hire`} jobsBaseOverride={`/api/marketplace/agents/${agentId}/hire/jobs`} /> : null;
}

function Erc8183BrowserDemo({ mode, deployment, agentName, embedded = false, recoveryOnly = false, evidence, initialQuote = null, apiBaseOverride, jobsBaseOverride, quoteRequestId = null, onQuoteExpired, onRecoveryActiveChange }: {
  mode: "testnet" | "mainnet";
  deployment: Erc8183BrowserDeployment;
  agentName?: string;
  embedded?: boolean;
  recoveryOnly?: boolean;
  onRecoveryActiveChange?: (active: boolean) => void;
  evidence?: EmbeddedHireEvidence;
  initialQuote?: MainnetQuoteResponse | null;
  apiBaseOverride?: string;
  jobsBaseOverride?: string;
  quoteRequestId?: number | null;
  onQuoteExpired?: () => void;
}) {
  const router = useRouter();
  const apiBase = apiBaseOverride ?? (mode === "mainnet" ? "/api/marketplace/demo/erc8183-mainnet" : "/api/marketplace/demo/erc8183");
  const jobsBase = jobsBaseOverride ?? (mode === "mainnet" ? "/api/marketplace/jobs/mainnet" : "/api/marketplace/jobs/testnet");
  const jobPageBase = mode === "mainnet" ? "/jobs/mainnet" : "/jobs/testnet";
  const [quote, setQuote] = useState<MainnetQuoteResponse | null>(initialQuote);
  const [quoteClock, setQuoteClock] = useState(() => Math.floor(Date.now() / 1_000));
  const { address, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [walletHydrated, setWalletHydrated] = useState(false);
  const account = walletHydrated && isConnected && address ? address : null;
  const [plan, setPlan] = useState<Erc8183HirePlan | null>(null);
  const [hireMode, setHireMode] = useState<BrowserHireMode | null>(null);
  const [journal, setJournal] = useState<Erc8183BrowserJournal | null>(null);
  const [journalRestored, setJournalRestored] = useState(false);
  const [savedJournal, setSavedJournal] = useState<Erc8183BrowserJournal | null>(null);
  const [job, setJob] = useState<Erc8183JobFacts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryJobId, setRecoveryJobId] = useState("");
  useEffect(() => {
    onRecoveryActiveChange?.(journalRestored && job !== null);
    return () => onRecoveryActiveChange?.(false);
  }, [journalRestored, job, onRecoveryActiveChange]);

  const readJob = useCallback(async (jobId: string) => {
    const activeRequestId = journalRestored ? journal?.quoteRequestId ?? null : quoteRequestId;
    const trackingUrl = activeRequestId === null
      ? `${jobsBase}/${jobId}`
      : `${jobsBase}/${jobId}?quoteRequestId=${encodeURIComponent(String(activeRequestId))}`;
    const tracking = await apiJson<{ job: Erc8183JobFacts | null }>(trackingUrl);
    if (!tracking.job) throw new Error("Current chain state is temporarily unavailable.");
    const current = tracking.job;
    setJob(current);
    return current;
  }, [jobsBase, quoteRequestId, journalRestored, journal?.quoteRequestId]);

  useEffect(() => {
    setWalletHydrated(true);
  }, []);

  useEffect(() => {
    const stored = loadBrowserJournal(localStorage, deployment);
    if (stored?.jobId) saveBrowserJournal(stored, localStorage, deployment);
    setSavedJournal(stored);
    setJournal(null);
    setJournalRestored(false);
    setJob(null);
    setPlan(null);
    setError(null);
  }, [deployment, quoteRequestId, account]);

  useEffect(() => {
    if (!quote) return;
    setQuoteClock(Math.floor(Date.now() / 1_000));
    const delay = Math.max(0, quote.quoteExpiresAt * 1_000 - Date.now() + 25);
    const timeout = window.setTimeout(
      () => setQuoteClock(Math.floor(Date.now() / 1_000)),
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [quote]);

  const requestQuote = async () => {
    if (apiBaseOverride) {
      setError("Quote expired. Return to the quote request to obtain a fresh buyer quote.");
      onQuoteExpired?.();
      return;
    }
    setBusy("Requesting a signed quote");
    setError(null);
    setQuote(null);
    setPlan(null);
    setJournal(null);
    setJournalRestored(false);
    setJob(null);
    setHireMode(null);
    reportHireEvent(deployment, { phase: "clicked" });
    try {
      const result = await apiJson<MainnetQuoteResponse>(`${apiBase}/quote`, { method: "POST" });
      setQuote(result);
      if (result.observationSync?.status === "synced" || result.observationSync?.status === "duplicate") {
        markCatalogForRefresh();
      }
      if (
        journal?.lastConfirmedStep === "submitted"
        || job?.status === "SUBMITTED"
        || job?.status === "COMPLETED"
      ) {
        // Detach the terminal execution so this fresh quote can start a new hire.
        // Its persisted journal remains available until a new execution progresses.
        setJournal(null);
        setJournalRestored(false);
        setJob(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quote request failed.");
    } finally {
      setBusy(null);
    }
  };

  const connectAndPrepare = async () => {
    if (!quote) return;
    if (quote.quoteExpiresAt <= Math.floor(Date.now() / 1_000)) {
      setError("Quote expired. Request a fresh quote before preparing this hire.");
      setPlan(null);
      return;
    }
    if (!account) {
      setError("Connect a wallet from the header before preparing this hire.");
      return;
    }
    setBusy("Preparing the connected wallet");
    setError(null);
    try {
      await switchChainAsync({ chainId: deployment.chainId });
      const buyer = account;
      const prepared = await apiJson<Erc8183HirePlan>(`${apiBase}/prepare`, {
        method: "POST",
        body: JSON.stringify({ buyer, quote: quote.envelope, ...(quoteRequestId === null ? {} : { quoteRequestId }) }),
      });
      if (journal && journal.buyer.toLowerCase() !== buyer.toLowerCase()) {
        throw new Error("The saved journal belongs to a different wallet. Reconnect that wallet or clear the journal.");
      }
      setPlan(prepared);
      if (journal?.jobId) await readJob(journal.jobId);
      else if (connector) {
        const provider = (await connector.getProvider()) as InjectedProvider;
        setHireMode(await detectBrowserHireMode(provider, buyer, deployment));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet preparation failed.");
    } finally {
      setBusy(null);
    }
  };

  const signAndRun = async () => {
    if (!account) return;
    setBusy("Waiting for wallet confirmations");
    setError(null);
    try {
      // A funded job only needs an off-chain notification. Never enter the
      // wallet execution path again, even if that notification previously failed.
      if (journal?.jobId && job && ["FUNDED", "SUBMITTED", "COMPLETED"].includes(job.status)) {
        setBusy("Notifying seller");
        const current = await readJob(journal.jobId);
        setJob(current);
        if (journalRestored) recoverFundedBrowserJournal(current, journal, account, deployment);
        if (current.buyer.toLowerCase() !== account.toLowerCase() || current.provider.toLowerCase() !== deployment.seller.toLowerCase() || current.chainId !== deployment.chainId) throw new Error("Job does not belong to this buyer and seller.");
        if (current.status === "SUBMITTED" || current.status === "COMPLETED") return;
        if (current.status !== "FUNDED") throw new Error("Funding could not be verified. No transaction was sent.");
        const notification = await apiJson<NotifyFundedResult>(`${apiBase}/notify`, {
          method: "POST",
          body: JSON.stringify({ buyer: account, jobId: current.jobId, ...(journalRestored ? { quoteRequestId: journal.quoteRequestId } : quoteRequestId === null ? {} : { quoteRequestId }) }),
        });
        setJob(notification.job);
        return;
      }
      if (!plan) return;
      if (!connector) throw new Error("The connected wallet is no longer available.");
      const provider = (await connector.getProvider()) as InjectedProvider;
      if (job && (job.status === "SUBMITTED" || job.status === "COMPLETED")) return;
      const execution = await executeBrowserHire(provider, plan, {
        ...(quoteRequestId === null ? {} : { quoteRequestId }),
        journal,
        recoveredJob: job,
        onProgress: ({ step, journal: next }) => {
          setJournal(next);
          const txHash = step === "created" ? next.transactions.createJob : step === "funded" ? next.transactions.fund : undefined;
          if ((step === "created" || step === "funded") && next.jobId && txHash) {
            reportHireEvent(deployment, { phase: step, jobId: next.jobId, txHash }, { quoteRequestId: next.quoteRequestId ?? null });
          }
        },
        deployment,
      });
      setJournal(execution.journal);
      await readJob(execution.jobId);
      setBusy("Notifying seller");
      const notification = await apiJson<NotifyFundedResult>(`${apiBase}/notify`, {
        method: "POST",
        body: JSON.stringify({ buyer: account, jobId: execution.jobId, ...(execution.journal.quoteRequestId ? { quoteRequestId: execution.journal.quoteRequestId } : {}) }),
      });
      let nextJournal: Erc8183BrowserJournal = {
        ...execution.journal,
        lastConfirmedStep: "notified",
      };
      if (notification.job.status === "SUBMITTED" || notification.job.status === "COMPLETED") {
        if (notification.sellerTransactionHash) {
          reportHireEvent(deployment, { phase: "submitted", jobId: execution.jobId, txHash: notification.sellerTransactionHash }, { quoteRequestId: execution.journal.quoteRequestId ?? null });
        }
        nextJournal = {
          ...nextJournal,
          ...(notification.sellerTransactionHash ? { transactions: { ...nextJournal.transactions, submit: notification.sellerTransactionHash } } : {}),
          lastConfirmedStep: "submitted",
        };
      }
      saveBrowserJournal(nextJournal, localStorage, deployment);
      setJournal(nextJournal);
      setJob(notification.job);
      if (mode === "testnet") router.push(`${jobPageBase}/${execution.jobId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The browser transaction flow stopped.");
    } finally {
      setBusy(null);
    }
  };

  const recoverJob = async (selectedJobId = recoveryJobId) => {
    if (!account || !/^\d+$/.test(selectedJobId)) {
      setError("Connect the original buyer wallet and select a saved job.");
      return;
    }
    setBusy("Recovering confirmed job");
    setError(null);
    try {
      const savedRequestId = savedJournal?.jobId === selectedJobId ? savedJournal.quoteRequestId : undefined;
      if (apiBaseOverride && !savedRequestId) throw new Error("This older job has no saved quote reference. Open job history to inspect it; it cannot be attached to your new quote.");
      const tracking = await apiJson<{ job: Erc8183JobFacts | null }>(`${jobsBase}/${selectedJobId}${savedRequestId ? `?quoteRequestId=${savedRequestId}` : ""}`);
      if (!tracking.job) throw new Error("Current chain state is temporarily unavailable.");
      const current = tracking.job;
      const saved = savedJournal?.jobId === selectedJobId ? savedJournal : null;
      const recovered = saved && ["FUNDED", "SUBMITTED", "COMPLETED"].includes(current.status)
        ? recoverFundedBrowserJournal(current, saved, account, deployment)
        : (() => { throw new Error("This job is not funded. Open job history; a new quote cannot authorize its remaining payments."); })();
      setJournal(recovered);
      setPlan(null);
      setJournalRestored(true);
      setJob(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The confirmed job could not be recovered.");
    } finally {
      setBusy(null);
    }
  };

  const signaturePurpose = plan?.transactions.filter(({ required }) => required) ?? [];
  const previousHire = savedJournal?.jobId && !journal ? <div className="mb-4 rounded-lg border border-border p-3 text-sm">
    <p className="text-muted-foreground">Previous hire · wallet <span className="break-all font-mono text-xs">{savedJournal.buyer}</span> · {savedJournal.startedAt ? new Date(savedJournal.startedAt).toUTCString() : "Date unavailable"}</p>
    <Button className="mt-2" type="button" variant="outline" disabled={busy !== null || account?.toLowerCase() !== savedJournal.buyer.toLowerCase()} onClick={() => void recoverJob(savedJournal.jobId!)}>Resume job #{savedJournal.jobId}</Button>
    {!account ? <p className="mt-1 text-xs text-muted-foreground">Connect the original buyer wallet to verify this previous job.</p> : null}
  </div> : null;
  const pendingSignatures = signaturePurpose.filter(({ kind }) => journal?.receipts?.[kind] === undefined).length;
  const quoteExpired = quote !== null && quote.quoteExpiresAt <= quoteClock;
  const historicalQuote = quote === null && evidence?.quoteStatus === "verified_historical";
  const needsFreshQuote = quoteExpired || historicalQuote;
  const submitted = job?.status === "SUBMITTED" || job?.status === "COMPLETED";
  const funded = job !== null && ["FUNDED", "SUBMITTED", "COMPLETED"].includes(job.status);
  const fundingReceiptRecorded = journal?.receipts?.fund !== undefined;
  const stopTitle = fundingReceiptRecorded || funded ? "Funding confirmed · seller step stopped" : "Stopped safely";
  const stopDetail = fundingReceiptRecorded || funded
    ? `${error ?? "The seller step could not be completed."} No additional buyer transaction was sent after the funding receipt.`
    : error;
  const downloadEvidence = () => {
    if (!journal || !job || !plan) return;
    const evidence = {
      schemaVersion: 1,
      chainId: deployment.chainId,
      network: deployment.networkName,
      agentId: deployment.agentId,
      buyer: journal.buyer,
      seller: journal.seller,
      jobId: job.jobId,
      state: job.status,
      budgetRaw: plan.quote.priceRaw,
      token: plan.quote.token,
      startedAt: journal.startedAt ?? null,
      capturedAt: new Date().toISOString(),
      transactions: journal.transactions,
      receipts: journal.receipts ?? {},
      deliverableHash: job.deliverableHash,
      resultHashVerified: job.result?.hashVerified === true,
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `erc8183-${deployment.chainId}-job-${job.jobId}-sanitized.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (journalRestored && job) {
    return <section aria-label="Resumed hire" className="flex flex-col gap-3">
      <p role="status">Resumed job #{job.jobId} · {job.status}</p>
      <p className="text-sm text-muted-foreground">Wallet {journal?.buyer}. Previous receipts remain in job history. No new payment is required.</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href={`${jobPageBase}/${job.jobId}`}>View job history</Link></Button>
        {job.status === "FUNDED" ? <Button disabled={busy !== null} onClick={() => void signAndRun()}>
          {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="inline-start" /> : null}
          {busy ? "Notifying seller…" : "Retry seller notification"}
        </Button> : null}
        <Button variant="ghost" disabled={busy !== null} onClick={() => { setJournal(null); setJob(null); setJournalRestored(false); }}>Leave this job · keep history</Button>
      </div>
      {error ? <p role="alert">{stopTitle}: {stopDetail}</p> : null}
    </section>;
  }

  if (recoveryOnly) return <div>{previousHire}{busy ? <p role="status">Recovering saved job…</p> : null}{error ? <p role="alert">{error}</p> : null}</div>;

  if (embedded) {
    const activeStep = quoteExpired || !quote ? "quote" : !plan ? "review" : !submitted ? "fund" : "track";
    const stepState = (step: "quote" | "review" | "fund" | "track") => {
      const order = ["quote", "review", "fund", "track"] as const;
      const current = order.indexOf(activeStep);
      const position = order.indexOf(step);
      return position < current ? "complete" as const : position === current ? "current" as const : "locked" as const;
    };

    return (
      <section aria-busy={busy !== null} aria-label="ERC-8183 hiring flow" className="w-full">
        {previousHire}
        {busyStatusLabel(busy) ? (
          <p aria-live="polite" className="mb-4 inline-flex items-center gap-2 text-xs text-cyan-200" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{busyStatusLabel(busy)}…
          </p>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start">
          <div>
            <ol aria-label="Hiring progress" className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.015]">
              <CheckoutStep label="Quote" number={1} state={stepState("quote")}>
                <div className="grid overflow-hidden rounded-lg border border-white/10 sm:grid-cols-2 sm:divide-x sm:divide-white/10">
                  <div className="px-4 py-3">
                    <span className="text-xs text-zinc-500">Outcome</span>
                    <p className="mt-1 text-sm text-zinc-100">Grid trading plan</p>
                  </div>
                  <div className="border-t border-white/10 px-4 py-3 sm:border-t-0">
                    <span className="text-xs text-zinc-500">Budget</span>
                    <p className="mt-1 text-sm text-zinc-100">Set by quote</p>
                  </div>
                </div>
                {evidence ? (
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-zinc-200">{evidence.protocol.toUpperCase()} endpoint health</p>
                        <a
                          className="mt-1 block truncate text-xs text-zinc-500 underline decoration-white/10 underline-offset-4 transition-colors hover:text-zinc-200"
                          href={evidence.endpoint}
                          rel="noreferrer"
                          target="_blank"
                          title={evidence.endpoint}
                        >
                          {evidence.endpoint.replace(/^https?:\/\//, "")}<ExternalLink aria-hidden="true" className="ml-1 inline size-3" />
                        </a>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href="#validation">Recheck</Link>
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.07] pt-3 text-xs">
                      <span className={evidence.reachable ? "text-emerald-300" : "text-amber-200"}>
                        {evidence.reachable ? "Endpoint verified" : "Check required"}
                      </span>
                      {typeof evidence.httpStatus === "number" ? <span className="text-zinc-400">HTTP {evidence.httpStatus}</span> : null}
                      {typeof evidence.durationMs === "number" ? <span className="text-zinc-400">{evidence.durationMs} ms</span> : null}
                      {evidence.lastCheckedAt ? (
                        <span className="inline-flex items-center gap-1 text-zinc-500">
                          <Clock3 aria-hidden="true" className="size-3" />
                          <time dateTime={evidence.lastCheckedAt} title={evidence.lastCheckedAt}>{relativeAge(evidence.lastCheckedAt)}</time>
                        </span>
                      ) : null}
                      {typeof evidence.attemptCount === "number" ? <span className="ml-auto text-zinc-600">{evidence.attemptCount} checks</span> : null}
                    </div>
                  </div>
                ) : null}
                {needsFreshQuote ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-sm text-amber-200" role="status">
                    <span>Quote expired</span><span className="text-xs">Request a fresh quote to continue</span>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button className="min-w-48" disabled={busy !== null} onClick={() => void requestQuote()} size="lg">
                    {busy === "Requesting a signed quote" ? <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="inline-start" /> : null}
                    {busy === "Requesting a signed quote" ? "Requesting quote…" : needsFreshQuote ? "Request fresh quote" : "Request quote"}<ArrowRight aria-hidden="true" data-icon="inline-end" />
                  </Button>
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><ShieldCheck aria-hidden="true" className="size-4" />No signature</span>
                </div>
              </CheckoutStep>

              <CheckoutStep label="Review" number={2} state={stepState("review")}>
                {quote ? (
                  <>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-white/10 px-4 py-3">
                        <dt className="text-xs text-zinc-500">Price</dt>
                        <dd className="mt-1 text-sm font-medium text-white">{quote.priceDisplay} {quote.tokenSymbol}</dd>
                      </div>
                      <div className="rounded-lg border border-white/10 px-4 py-3">
                        <dt className="text-xs text-zinc-500">Valid until</dt>
                        <dd className="mt-1 text-sm text-zinc-200">{new Date(quote.quoteExpiresAt * 1_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
                      </div>
                    </dl>
                    {mode === "mainnet" ? <p className="mt-3 text-xs text-zinc-500" role="status">{sharedEvidenceSyncMessage(quote.observationSync)}</p> : null}
                    {!account ? <div className="mt-4"><WalletConnectButton /></div> : <Button className="mt-4 min-w-44" disabled={busy !== null} onClick={() => void connectAndPrepare()} size="lg">
                      {busy === "Preparing the connected wallet" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Wallet aria-hidden="true" />}
                      {busy === "Preparing the connected wallet" ? "Preparing wallet…" : "Prepare hire"}
                    </Button>}
                  </>
                ) : null}
              </CheckoutStep>

              <CheckoutStep label="Authorize & fund" number={3} state={stepState("fund")}>
                {plan ? (
                  <>
                    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                      <div><dt className="text-xs text-zinc-500">Balance</dt><dd className="mt-1 text-sm text-zinc-200">{displayUnits(plan.tokenBalanceRaw, plan.quote.tokenDecimals)} {plan.quote.tokenSymbol}</dd></div>
                      <div><dt className="text-xs text-zinc-500">Allowance</dt><dd className="mt-1 text-sm text-zinc-200">{plan.approvalRequired ? `Exact ${plan.quote.priceDisplay} ${plan.quote.tokenSymbol}` : "Ready"}</dd></div>
                    </dl>
                    <div className="mt-4">{journalRestored && job ? <p role="status">Resumed job #{job.jobId} · {job.status}. Previous receipts are available in <Link className="underline" href={`${jobPageBase}/${job.jobId}`}>job history</Link>.</p> : <Erc8183TransactionList explorerUrl={deployment.explorerUrl} intents={plan.transactions} journal={journal} mode={hireMode} />}</div>
                    {!journal?.jobId && hireConfirmationLabel(hireMode, signaturePurpose.length) ? (
                      <p className="mt-3 text-xs text-zinc-500" role="status">{hireConfirmationLabel(hireMode, signaturePurpose.length)}</p>
                    ) : null}
                    <Button className="mt-4 min-w-44" disabled={busy !== null || submitted} onClick={() => void signAndRun()} size="lg">
                      <Wallet aria-hidden="true" />
                      {busy === "Waiting for wallet confirmations"
                        ? "Waiting for confirmations…"
                        : journal?.jobId
                          ? funded ? "Retry seller notification" : pendingSignatures > 0
                            ? `Continue ${pendingSignatures} wallet approval${pendingSignatures === 1 ? "" : "s"}`
                            : "Retry seller notification"
                          : hireMode === "batched"
                            ? "Authorize hire (one confirmation)"
                            : `Begin ${signaturePurpose.length || 0} wallet approval${signaturePurpose.length === 1 ? "" : "s"}`}
                    </Button>
                    {!journal?.jobId ? (
                      <details className="mt-4 border-t border-white/10 pt-4 text-sm text-zinc-500">
                        <summary className="cursor-pointer select-none">Recover interrupted job</summary>
                        <div className="mt-3 flex gap-2">
                          <Input aria-label="Confirmed Job ID" inputMode="numeric" onChange={(event) => setRecoveryJobId(event.target.value.trim())} placeholder="Job ID" value={recoveryJobId} />
                          <Button disabled={busy !== null || !/^\d+$/.test(recoveryJobId)} onClick={() => void recoverJob()} variant="outline">{busy === "Recovering confirmed job" ? "Recovering…" : "Recover"}</Button>
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </CheckoutStep>

              <CheckoutStep label="Track" number={4} state={stepState("track")}>
                {job ? (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div><p className="text-xs text-zinc-500">Job #{job.jobId}</p><p className="mt-1 text-sm font-medium text-emerald-300">{job.status}</p></div>
                    <Button asChild variant="outline"><Link href={`${jobPageBase}/${job.jobId}`}>Open tracker<ArrowRight aria-hidden="true" /></Link></Button>
                  </div>
                ) : null}
              </CheckoutStep>
            </ol>

            {error ? (
              <Alert className="mt-4" variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{stopTitle}</AlertTitle>
                <AlertDescription>{stopDetail}</AlertDescription>
                {!quote ? <Button className="mt-3" disabled={busy !== null} onClick={() => void requestQuote()} size="sm" variant="outline">Try quote again</Button> : null}
              </Alert>
            ) : null}
          </div>

          <aside aria-label="Hire summary" className="flex flex-col gap-3 lg:sticky lg:top-6">
            <section className="rounded-xl border border-white/10 bg-white/[0.015] px-5">
              <h2 className="border-b border-white/10 py-4 text-sm font-medium text-white">Hire summary</h2>
              <dl>
                <CheckoutSummaryRow label="Agent" value={agentName ?? `Agent ${deployment.agentId}`} />
                <CheckoutSummaryRow label="Network" value={<a className="inline-flex items-center justify-end gap-1 text-right text-zinc-200 underline decoration-white/20 underline-offset-4 hover:text-white" href={deployment.explorerUrl} rel="noreferrer" target="_blank">{deployment.networkName} · {deployment.chainId}<ExternalLink aria-hidden="true" className="size-3" /></a>} />
                <CheckoutSummaryRow label="Quote" value={quote && !quoteExpired
                  ? `${quote.priceDisplay} ${quote.tokenSymbol}`
                  : <span className={needsFreshQuote ? "text-amber-200" : undefined}>{needsFreshQuote ? "Expired — refresh required" : "Not requested"}</span>} />
                <CheckoutSummaryRow label="Wallet" value={account ? <ChainReference explorerUrl={deployment.explorerUrl} kind="address" value={account} /> : "Not connected"} mono={account !== null} />
              </dl>
              <p className="flex items-center gap-2 border-t border-white/10 py-4 text-xs text-zinc-500">
                <ShieldCheck aria-hidden="true" className="size-4 text-emerald-400" />
                {activeStep === "quote" || activeStep === "review"
                  ? "No signature yet"
                  : hireMode === "batched"
                    ? "One wallet confirmation"
                    : hireMode === "sequential"
                      ? `${signaturePurpose.length} wallet approval${signaturePurpose.length === 1 ? "" : "s"}`
                      : "You approve every transaction"}
              </p>
            </section>

            <details className="group rounded-xl border border-white/10 bg-white/[0.015]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-zinc-200">
                Contracts &amp; permissions<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <dl className="border-t border-white/10 px-5 pb-3">
                <CheckoutSummaryRow label="Custody" value="Your wallet" />
                <CheckoutSummaryRow label="Approval" value={plan?.approvalRequired ? "Exact quote only" : "Checked before funding"} />
                <CheckoutSummaryRow label="Escrow" value="ERC-8183" />
              </dl>
            </details>

            {journal && !submitted ? <Button className="w-full" onClick={() => { setJournal(null); setJournalRestored(false); setJob(null); setPlan(null); setError(null); }} variant="ghost">Leave this job · keep history</Button> : null}
            {submitted && journal && job && plan ? <Button className="w-full" onClick={downloadEvidence} variant="ghost">Download evidence</Button> : null}
          </aside>
        </div>
      </section>
    );
  }

  const Root = embedded ? "section" : "main";
  const Title = embedded ? "h2" : "h1";
  return (
    <Root
      {...(embedded ? { "aria-label": "ERC-8183 hiring flow" } : { id: "main-content" })}
      aria-busy={busy !== null}
      className={embedded ? "w-full" : "mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14"}
    >
      {previousHire}
      {!embedded ? (
        <>
          <header className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100" variant="outline">{deployment.networkName} · chain {deployment.chainId}</Badge>
              <Badge variant="outline">{mode === "mainnet" ? "Mainnet value at risk" : "Controlled hiring demo"}</Badge>
            </div>
            <p className="font-eyebrow font-eyebrow-dot mt-6 text-zinc-500">Non-custodial {mode === "mainnet" ? "Mainnet hire" : "Testnet demo"}</p>
            <Title className="mt-2 text-3xl font-light tracking-tight text-white sm:text-5xl">Hire with your wallet. Verify every step.</Title>
            <p className="mt-4 text-base leading-relaxed text-zinc-400">
              Request a signed quote from {agentName ?? "the controlled seller"}, inspect every contract call, and sign the ERC-8183 lifecycle with your injected wallet.
            </p>
          </header>

          <Alert className="mt-8 border-amber-300/20 bg-amber-300/[0.05]">
            <FlaskConical aria-hidden="true" className="text-amber-300" />
            <AlertTitle>{mode === "mainnet" ? "Marketplace-operated Grid seller — not an official BNB reference agent" : "Testing infrastructure — not a marketplace agent"}</AlertTitle>
            <AlertDescription>Only Agent {deployment.agentId} is allowed. The HeyAnon marketplace candidates remain MCP only and cannot use this flow.</AlertDescription>
          </Alert>
        </>
      ) : null}

      {busyStatusLabel(busy) ? (
        <p aria-live="polite" className="mt-4 inline-flex items-center gap-2 text-xs text-cyan-200" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{busyStatusLabel(busy)}…
        </p>
      ) : null}

      <div className={`${embedded ? "" : "mt-8 "}grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]`}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1 · Get a server-verified quote</CardTitle>
              <CardDescription>The server resolves Agent {deployment.agentId}, checks its fixed HTTPS origin, fetches its Agent Card, and validates the signed quote.</CardDescription>
            </CardHeader>
            <CardContent>
              {quote ? (
                <>
                  <dl>
                    <SummaryRow label="Seller Agent" value={`${quote.agentId} · ${shortAddress(quote.provider)}`} />
                    <SummaryRow label="Negotiated endpoint" value={quote.endpoint} mono />
                    <SummaryRow label="Payment" value={`${quote.priceRaw} raw ${quote.tokenSymbol} · ${quote.priceDisplay} formatted`} />
                    <SummaryRow label="Quote expires" value={new Date(quote.quoteExpiresAt * 1_000).toLocaleString()} />
                    <SummaryRow label="Commerce" value={quote.commerce} mono />
                  </dl>
                  {mode === "mainnet" && (
                    <p className="mt-4 text-xs text-zinc-400" role="status">
                      {sharedEvidenceSyncMessage(quote.observationSync)}
                    </p>
                  )}
                  {quoteExpired && (
                    <p className="mt-4 text-sm text-amber-200" role="status">Quote expired. Request a fresh quote before preparing or signing.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-zinc-400">No quote is cached in the browser. Requesting one performs no transaction and asks for no wallet access.</p>
              )}
              <Button className="mt-5" disabled={busy !== null} onClick={() => void requestQuote()}>
                {busy === "Requesting a signed quote" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                {busy === "Requesting a signed quote" ? "Requesting quote…" : quote ? "Request fresh quote" : mode === "mainnet" ? "Get fresh quote" : "Request live quote"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2 · Prepare and inspect balances</CardTitle>
              <CardDescription>Your wallet reveals only its public account. The server then reads balances and allowance; no signature is requested.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled={!quote || quoteExpired || !account || busy !== null} onClick={() => void connectAndPrepare()} variant={plan ? "outline" : "default"}>
                <Wallet aria-hidden="true" />
                {busy === "Preparing the connected wallet" ? "Preparing wallet…" : account ? `Prepare hire as ${shortAddress(account)}` : "Connect a wallet in the header"}
              </Button>
              {plan && (
                <dl className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4">
                  <SummaryRow label="Network" value={`${deployment.networkName} · chain ${plan.quote.chainId}`} />
                  <SummaryRow label="Buyer" value={plan.buyer} mono />
                  <SummaryRow label="Seller" value={plan.seller} mono />
                  <SummaryRow label={`${deployment.nativeCurrencySymbol} balance`} value={`${displayUnits(plan.nativeBalanceRaw, 18)} ${deployment.nativeCurrencySymbol}`} />
                  <SummaryRow label={`${plan.quote.tokenSymbol} balance`} value={`${displayUnits(plan.tokenBalanceRaw, plan.quote.tokenDecimals)} ${plan.quote.tokenSymbol}`} />
                  <SummaryRow label="Current allowance" value={`${plan.allowanceRaw} raw units`} />
                  <SummaryRow label="Approval" value={plan.approvalRequired ? `Required · exact ${plan.approvalAmountRaw} raw units` : "Not required · current allowance is sufficient"} />
                  <SummaryRow label="Budget" value={`${plan.quote.priceRaw} raw · ${plan.quote.priceDisplay} ${plan.quote.tokenSymbol}`} />
                  <SummaryRow label="Job deadline" value={`${new Date(Number(plan.deadline) * 1_000).toLocaleString()} · ${plan.deadline}`} />
                  <SummaryRow label="Time remaining" value={`${Math.max(0, Number(plan.deadline) - Math.floor(Date.now() / 1_000))} seconds`} />
                  <SummaryRow label="Policy" value={plan.quote.policy} mono />
                  <SummaryRow label="Maximum signatures" value={String(plan.maximumSignatures)} />
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3 · Authorize the hire</CardTitle>
              <CardDescription>
                {hireMode === "batched"
                  ? "Your wallet can execute the required calls as one atomic confirmation. Nothing is sent until you authorize it."
                  : hireMode === "sequential"
                    ? "Your wallet will show each required call in order. Nothing is sent until you authorize each one."
                    : "Review the exact calls first. Nothing is sent until you start the wallet authorization below."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {plan ? (
                journalRestored && job ? <p role="status">Resumed job #{job.jobId} · {job.status}. <Link className="underline" href={`${jobPageBase}/${job.jobId}`}>View job history</Link></p> : <Erc8183TransactionList explorerUrl={deployment.explorerUrl} intents={plan.transactions} journal={journal} mode={hireMode} />
              ) : <p className="text-sm text-zinc-500">Connect a wallet to calculate the exact transaction set.</p>}
              <Button className="mt-5" disabled={!plan || quoteExpired || busy !== null || submitted} onClick={() => void signAndRun()}>
                <Wallet aria-hidden="true" />
                {busy === "Waiting for wallet confirmations"
                  ? "Waiting for confirmations…"
                  : submitted
                  ? "Job already submitted"
                  : journal?.jobId
                    ? funded ? "Retry seller notification" : pendingSignatures > 0
                      ? `Continue ${pendingSignatures} wallet approval${pendingSignatures === 1 ? "" : "s"}`
                      : "Retry seller notification"
                    : hireMode === "batched"
                      ? "Authorize hire (one confirmation)"
                      : `Begin ${signaturePurpose.length || 0} wallet approval${signaturePurpose.length === 1 ? "" : "s"}`}
              </Button>
              {plan && !journal?.jobId && hireConfirmationLabel(hireMode, signaturePurpose.length) ? (
                <p className="mt-3 text-xs text-zinc-500" role="status">{hireConfirmationLabel(hireMode, signaturePurpose.length)}</p>
              ) : null}
              {plan && !journal?.jobId && (
                <div className="mt-5 border-t border-white/[0.07] pt-5">
                  <p className="text-xs leading-relaxed text-zinc-500">
                    If a confirmed createJob transaction was interrupted before this browser saved its Job ID, recover it from chain instead of creating a duplicate.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Input
                      aria-label="Confirmed Job ID"
                      inputMode="numeric"
                      onChange={(event) => setRecoveryJobId(event.target.value.trim())}
                      placeholder="Confirmed Job ID"
                      value={recoveryJobId}
                    />
                    <Button disabled={busy !== null || !/^\d+$/.test(recoveryJobId)} onClick={() => void recoverJob()} variant="outline">
                      {busy === "Recovering confirmed job" ? "Recovering…" : "Recover"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <h2 className="text-base font-medium text-zinc-100">Guardrails and continuing authority</h2>
              <CardDescription>What this flow can authorize, and where user control ends.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4 text-xs leading-relaxed text-zinc-400">
                <div><dt className="font-medium text-zinc-200">Custody</dt><dd className="mt-1">The injected wallet signs each buyer transaction. The server never receives the buyer private key.</dd></div>
                <div><dt className="font-medium text-zinc-200">Spend and token authority</dt><dd className="mt-1">The seller sets the quoted price. Approval is the exact quote amount when needed, never unlimited, and targets only the configured Commerce contract.</dd></div>
                <div><dt className="font-medium text-zinc-200">Before funding</dt><dd className="mt-1">Decline any wallet prompt to stop. No seller authority or escrow funding exists until the corresponding transactions confirm.</dd></div>
                <div><dt className="font-medium text-zinc-200">After funding</dt><dd className="mt-1">The budget is committed to ERC-8183 escrow and subsequent outcomes are contract and policy governed. The seller cannot sign for the buyer. This demo does not expose a cancellation action after funding.</dd></div>
                <div><dt className="font-medium text-zinc-200">Revocation</dt><dd className="mt-1">Any residual ERC-20 allowance can be set to zero through the token contract or wallet interface. Revoking allowance does not reverse funds already placed in escrow.</dd></div>
              </dl>
              {plan && <p className="mt-4 border-t border-white/[0.08] pt-4 text-xs text-zinc-300">This quote: spend {plan.quote.priceRaw} raw units · approval {plan.approvalRequired ? `exactly ${plan.approvalAmountRaw}` : "not required"} · {plan.maximumSignatures} signatures maximum.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Chain-verified receipt spine</CardTitle><CardDescription>Local journal entries are locators; receipts and current contract state are authoritative.</CardDescription></CardHeader>
            <CardContent>
              <ol className="space-y-4" aria-label="ERC-8183 browser spike progress">
                <EvidenceStep label="Quote verified" state={quote ? "verified" : "current"} />
                <EvidenceStep label={`Wallet on chain ${deployment.chainId}`} state={account ? "verified" : quote ? "current" : "pending"} />
                <EvidenceStep label="Job created" state={job ? "verified" : account ? "current" : "pending"} />
                <EvidenceStep label="Policy registered" state={job?.policy.toLowerCase() === deployment.policy.toLowerCase() ? "verified" : "pending"} />
                <EvidenceStep label="Budget set" state={job && BigInt(job.budgetRaw) > 0n ? "verified" : "pending"} />
                <EvidenceStep label="Escrow funded" state={funded ? "verified" : "pending"} />
                <EvidenceStep label="Seller notified" state={submitted ? "verified" : funded ? "current" : "pending"} />
                <EvidenceStep label="Result submitted" state={submitted ? "verified" : funded ? "current" : "pending"} />
              </ol>
            </CardContent>
          </Card>

          {job && (
            <Card className="border-emerald-400/20">
              <CardHeader><CardTitle>Onchain Job #{job.jobId}</CardTitle><CardDescription>Current state: {job.status}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <p className="font-hash text-xs text-zinc-400">Deliverable {job.deliverableHash}</p>
                {job.result && (
                  <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
                    <p className="font-eyebrow text-emerald-300">Hash-verified result</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{job.result.content}</p>
                  </div>
                )}
                {journal?.transactions && Object.entries(journal.transactions).map(([kind, hash]) => (
                  <a className="flex items-center justify-between gap-2 text-xs text-zinc-300 hover:text-white" href={`${deployment.explorerUrl}/tx/${hash}`} key={kind} rel="noreferrer" target="_blank">
                    <span>{kind}</span><span className="font-hash">{shortAddress(hash)}</span><ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                ))}
                {job.deliverableUrl && <a className="inline-flex items-center gap-2 text-sm text-emerald-300" href={job.deliverableUrl} rel="noreferrer" target="_blank">Open sanitized result <ExternalLink aria-hidden="true" className="size-4" /></a>}
                <Button asChild className="w-full" variant="outline">
                  <Link href={`${jobPageBase}/${job.jobId}`}>Open job tracker<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
                </Button>
                <Button className="w-full" onClick={downloadEvidence} variant="ghost">Download sanitized execution evidence</Button>
              </CardContent>
            </Card>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
            <AlertTitle>{stopTitle}</AlertTitle>
            <AlertDescription>{stopDetail}</AlertDescription>
              {!quote && <Button className="mt-3" disabled={busy !== null} onClick={() => void requestQuote()} size="sm" variant="outline">Try quote again</Button>}
            </Alert>
          )}

          {journal && !submitted && (
            <Button onClick={() => { setJournal(null); setJournalRestored(false); setJob(null); setPlan(null); setError(null); }} variant="ghost">
              Leave this job · keep history
            </Button>
          )}
        </aside>
      </div>
    </Root>
  );
}
