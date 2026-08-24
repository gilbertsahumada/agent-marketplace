"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Erc8183BrowserJournal,
  type Erc8183HirePlan,
  type Erc8183JobFacts,
  type NormalizedErc8183Quote,
  type NotifyFundedResult,
} from "@/src/business/entities/erc8183-browser-spike";
import type { MainnetDemoPublicConfig } from "@/src/business/entities/mainnet-browser-demo";
import {
  clearBrowserJournal,
  connectInjectedWallet,
  executeBrowserHire,
  loadBrowserJournal,
  saveBrowserJournal,
  ERC8183_TESTNET,
  type Erc8183BrowserDeployment,
} from "@/src/business/browser/erc8183-browser-wallet";

type ApiError = { error?: { code?: string; message?: string } };

type InjectedProvider = Parameters<typeof connectInjectedWallet>[0];

function injectedProvider(): InjectedProvider | null {
  return (window as Window & { ethereum?: InjectedProvider }).ethereum ?? null;
}

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
      <dd className={mono ? "font-stat break-all font-mono text-xs text-zinc-200" : "text-sm text-zinc-200"}>{value}</dd>
    </div>
  );
}

const TESTNET_DEPLOYMENT: Erc8183BrowserDeployment = {
  ...ERC8183_TESTNET,
  nativeCurrencyName: "tBNB",
  nativeCurrencySymbol: "tBNB",
};

export function Erc8183MainnetDemo({ config }: { config: MainnetDemoPublicConfig }) {
  return <Erc8183BrowserDemo mode="mainnet" deployment={{
    chainId: 56,
    networkName: "BNB Smart Chain",
    nativeCurrencyName: "BNB",
    nativeCurrencySymbol: "BNB",
    ...config,
    maximumBudgetRaw: BigInt(config.maximumBudgetRaw),
  }} />;
}

export function Erc8183TestnetDemo() {
  return <Erc8183BrowserDemo mode="testnet" deployment={TESTNET_DEPLOYMENT} />;
}

function Erc8183BrowserDemo({ mode, deployment }: { mode: "testnet" | "mainnet"; deployment: Erc8183BrowserDeployment }) {
  const router = useRouter();
  const apiBase = mode === "mainnet" ? "/api/marketplace/demo/erc8183-mainnet" : "/api/marketplace/demo/erc8183";
  const jobsBase = mode === "mainnet" ? "/api/marketplace/jobs/mainnet" : "/api/marketplace/jobs/testnet";
  const jobPageBase = mode === "mainnet" ? "/jobs/mainnet" : "/jobs/testnet";
  const [quote, setQuote] = useState<NormalizedErc8183Quote | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [plan, setPlan] = useState<Erc8183HirePlan | null>(null);
  const [journal, setJournal] = useState<Erc8183BrowserJournal | null>(null);
  const [job, setJob] = useState<Erc8183JobFacts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readJob = useCallback(async (jobId: string) => {
    const tracking = await apiJson<{ job: Erc8183JobFacts | null }>(`${jobsBase}/${jobId}`);
    if (!tracking.job) throw new Error("Current chain state is temporarily unavailable.");
    const current = tracking.job;
    setJob(current);
    return current;
  }, [jobsBase]);

  useEffect(() => {
    const stored = loadBrowserJournal(localStorage, deployment);
    setJournal(stored);
    if (stored?.jobId) {
      void readJob(stored.jobId).catch(() => {
        setError("The local journal was found, but current chain state could not be reconstructed.");
      });
    }
  }, [deployment, readJob]);

  const requestQuote = async () => {
    setBusy("Requesting a signed quote");
    setError(null);
    try {
      const result = await apiJson<NormalizedErc8183Quote>(`${apiBase}/quote`, { method: "POST" });
      setQuote(result);
      setPlan(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quote request failed.");
    } finally {
      setBusy(null);
    }
  };

  const connectAndPrepare = async () => {
    if (!quote) return;
    const provider = injectedProvider();
    if (!provider) {
      setError("No EIP-1193 injected wallet was detected in this browser.");
      return;
    }
    setBusy("Connecting the injected wallet");
    setError(null);
    try {
      const buyer = await connectInjectedWallet(provider, deployment);
      const prepared = await apiJson<Erc8183HirePlan>(`${apiBase}/prepare`, {
        method: "POST",
        body: JSON.stringify({ buyer, quote: quote.envelope }),
      });
      if (journal && journal.buyer.toLowerCase() !== buyer.toLowerCase()) {
        throw new Error("The saved journal belongs to a different wallet. Reconnect that wallet or clear the journal.");
      }
      setAccount(buyer);
      setPlan(prepared);
      if (journal?.jobId) await readJob(journal.jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet preparation failed.");
    } finally {
      setBusy(null);
    }
  };

  const signAndRun = async () => {
    if (!plan || !account) return;
    const provider = injectedProvider();
    if (!provider) return setError("The injected wallet is no longer available.");
    setBusy("Waiting for wallet confirmations");
    setError(null);
    try {
      if (job && (job.status === "SUBMITTED" || job.status === "COMPLETED")) return;
      const execution = await executeBrowserHire(provider, plan, {
        journal,
        recoveredJob: job,
        onProgress: ({ journal: next }) => setJournal(next),
        deployment,
      });
      setJournal(execution.journal);
      await readJob(execution.jobId);
      const notification = await apiJson<NotifyFundedResult>(`${apiBase}/notify`, {
        method: "POST",
        body: JSON.stringify({ buyer: account, jobId: execution.jobId }),
      });
      let nextJournal: Erc8183BrowserJournal = {
        ...execution.journal,
        lastConfirmedStep: "notified",
      };
      if (notification.job.status === "SUBMITTED" || notification.job.status === "COMPLETED") {
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

  const signaturePurpose = plan?.transactions.filter(({ required }) => required) ?? [];
  const submitted = job?.status === "SUBMITTED" || job?.status === "COMPLETED";
  const funded = job !== null && ["FUNDED", "SUBMITTED", "COMPLETED"].includes(job.status);
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

  return (
    <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-amber-300/30 bg-amber-300/10 text-amber-100" variant="outline">{deployment.networkName} · chain {deployment.chainId}</Badge>
          <Badge variant="outline">{mode === "mainnet" ? "Mainnet value at risk" : "Controlled hiring demo"}</Badge>
        </div>
        <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">Non-custodial {mode === "mainnet" ? "Mainnet" : "Testnet"} demo</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-5xl">Hire with your wallet. Verify every step.</h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          Request a signed quote from the controlled seller, inspect every contract call, and sign the ERC-8183 lifecycle with your injected wallet.
        </p>
      </header>

      <Alert className="mt-8 border-amber-300/20 bg-amber-300/[0.05]">
        <FlaskConical aria-hidden="true" className="text-amber-300" />
        <AlertTitle>{mode === "mainnet" ? "Marketplace-operated Grid seller — not an official BNB reference agent" : "Testing infrastructure — not a marketplace agent"}</AlertTitle>
        <AlertDescription>Only Agent {deployment.agentId} is allowed. The HeyAnon marketplace candidates remain MCP only and cannot use this flow.</AlertDescription>
      </Alert>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1 · Get a server-verified quote</CardTitle>
              <CardDescription>The server resolves Agent {deployment.agentId}, checks its fixed HTTPS origin, fetches its Agent Card, and validates the signed quote.</CardDescription>
            </CardHeader>
            <CardContent>
              {quote ? (
                <dl>
                  <SummaryRow label="Seller Agent" value={`${quote.agentId} · ${shortAddress(quote.provider)}`} />
                  <SummaryRow label="Negotiated endpoint" value={quote.endpoint} mono />
                  <SummaryRow label="Payment" value={`${quote.priceRaw} raw ${quote.tokenSymbol} · ${quote.priceDisplay} formatted`} />
                  <SummaryRow label="Quote expires" value={new Date(quote.quoteExpiresAt * 1_000).toLocaleString()} />
                  <SummaryRow label="Commerce" value={quote.commerce} mono />
                </dl>
              ) : (
                <p className="text-sm text-zinc-400">No quote is cached in the browser. Requesting one performs no transaction and asks for no wallet access.</p>
              )}
              <Button className="mt-5" disabled={busy !== null} onClick={() => void requestQuote()}>
                {busy === "Requesting a signed quote" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                {quote ? "Refresh live quote" : "Request live quote"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2 · Connect and inspect balances</CardTitle>
              <CardDescription>Connecting reveals only your public account. The server then reads balances and allowance; no signature is requested.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled={!quote || busy !== null} onClick={() => void connectAndPrepare()} variant={account ? "outline" : "default"}>
                <Wallet aria-hidden="true" />{account ? `Connected ${shortAddress(account)}` : "Connect injected wallet"}
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
              <CardTitle>3 · Review and sign sequentially</CardTitle>
              <CardDescription>Each call is simulated, then its receipt must succeed before the next wallet prompt appears.</CardDescription>
            </CardHeader>
            <CardContent>
              {plan ? (
                <ol className="space-y-3" aria-label="Expected wallet signatures">
                  {plan.transactions.map((intent) => (
                    <li key={intent.kind} className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-zinc-200">{intent.kind}</p>
                        <p className="mt-1 text-xs text-zinc-500">{intent.purpose}</p>
                        <p className="mt-1 break-all font-mono text-[10px] text-zinc-600">{intent.contract}</p>
                      </div>
                      <Badge variant="outline">{intent.required ? "signature" : "skipped"}</Badge>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-zinc-500">Connect a wallet to calculate the exact transaction set.</p>}
              <Button className="mt-5" disabled={!plan || busy !== null || submitted} onClick={() => void signAndRun()}>
                {busy === "Waiting for wallet confirmations" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Wallet aria-hidden="true" />}
                {submitted ? "Job already submitted" : `Begin ${signaturePurpose.length || 0} wallet signatures`}
              </Button>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
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
                <p className="font-mono text-xs break-all text-zinc-400">Deliverable {job.deliverableHash}</p>
                {job.result && (
                  <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-300">Hash-verified result</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{job.result.content}</p>
                  </div>
                )}
                {journal?.transactions && Object.entries(journal.transactions).map(([kind, hash]) => (
                  <a className="flex items-center justify-between gap-2 text-xs text-zinc-300 hover:text-white" href={`${deployment.explorerUrl}/tx/${hash}`} key={kind} rel="noreferrer" target="_blank">
                    <span>{kind}</span><span className="font-mono">{shortAddress(hash)}</span><ExternalLink aria-hidden="true" className="size-3" />
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
              <AlertTitle>Flow stopped safely</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {journal && !submitted && (
            <Button onClick={() => { clearBrowserJournal(localStorage, deployment); setJournal(null); setJob(null); setError(null); }} variant="ghost">
              Clear this browser journal
            </Button>
          )}
        </aside>
      </div>
    </main>
  );
}
