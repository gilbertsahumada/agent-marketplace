"use client";

import { useRef, useState } from "react";
import { useAccount } from "wagmi";
import { LoaderCircle } from "lucide-react";
import { executeBrowserClosure, type ClosureAction, type ClosureAttempt } from "@/src/business/browser/job-closure";
import { ERC8183_MAINNET } from "@/src/mainnet/contracts";
import type { DeliveryReport } from "@/src/mainnet/job-delivery";

export function JobClosureActions({ report, refresh }: { report: DeliveryReport; refresh: () => void }) {
  const { address, chainId, connector } = useAccount();
  if (!address || !connector) return <p className="text-sm text-muted-foreground">Connect your wallet to review closure actions.</p>;
  if (chainId !== 56) return <p className="text-sm text-muted-foreground">Switch your wallet to Mainnet before reviewing this job.</p>;
  return <ClosureControls key={`${report.jobId}:${address}:${chainId}`} report={report} wallet={address} getProvider={() => connector.getProvider()} refresh={refresh} />;
}

function ClosureControls({ report, wallet, getProvider, refresh }: { report: DeliveryReport; wallet: string; getProvider: () => Promise<unknown>; refresh: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState<ClosureAttempt | null>(null);
  const inFlight = useRef(false);
  const action: ClosureAction | null = report.closure === "review_window" ? "dispute" : report.closure === "settlement_available" ? "settle" : null;
  async function run(selected: ClosureAction, mode: "send" | "resume") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await executeBrowserClosure({ provider: await getProvider(), wallet, jobId: report.jobId, action: selected, mode });
      setAttempt(result);
      setMessage(result.state === "rejected" ? "You declined the wallet request. Review the action again if you want to retry." : result.state === "confirmed" ? "Closure transaction confirmed on-chain." : result.state === "reverted" ? "The closure transaction reverted. No new payment was sent." : "Confirmation is uncertain. Check the previous transaction; do not send again.");
      if (result.state === "reverted") setMessage("Transaction failed on-chain and may have used gas. Review the action to retry; the previous receipt will be checked again.");
      if (result.state === "cancelled" || result.state === "replaced") setMessage("The original transaction was replaced by a different operation. This did not confirm the closure. Review the job before retrying.");
      if (result.state === "already_closed") setMessage("This job is already closed. No new transaction was sent.");
      if (result.state === "confirmed" || result.state === "already_closed") refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not verify the closure action."); }
    finally { setBusy(false); inFlight.current = false; setReviewed(false); }
  }
  const button = "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:border-signal focus-visible:outline-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-50";
  return <fieldset className="space-y-3 border-t border-border pt-4" disabled={busy} aria-busy={busy}>
    <legend className="text-sm font-medium">Close this job</legend>
    <p className="text-sm text-muted-foreground">A closure transaction uses gas but does not fund the job again. Settlement applies the policy verdict; it is not a personal quality approval. Only the original buyer can dispute.</p>
    {action ? <>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-signal" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the delivery and understand this on-chain action.</label>
      <button className={button} disabled={!reviewed || busy} onClick={() => void run(action, "send")}>{busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{action === "dispute" ? "Dispute with wallet" : report.settlementOutcome === "rejected" ? "Settle rejection with wallet" : "Settle with wallet"}</button>
    </> : null}
    <div className="flex flex-wrap gap-2">
      <button className={button} onClick={() => void run("dispute", "resume")}>Check previous dispute transaction</button>
      <button className={button} onClick={() => void run("settle", "resume")}>Check previous settlement transaction</button>
    </div>
    {busy ? <p role="status" className="text-sm">Checking or awaiting wallet confirmation…</p> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {attempt?.hash ? <a className="text-sm text-signal underline" href={`${ERC8183_MAINNET.explorerUrl}/tx/${attempt.hash}`} target="_blank" rel="noopener noreferrer">Original transaction on explorer</a> : null}
    {attempt?.replacementHashes?.map(hash => <a key={hash} className="text-sm text-signal underline" href={`${ERC8183_MAINNET.explorerUrl}/tx/${hash}`} target="_blank" rel="noopener noreferrer">Replacement transaction on explorer</a>)}
  </fieldset>;
}
