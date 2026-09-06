# Buyer checkout recovery

New quote requests mount a fresh checkout. Loading a page or changing the connected wallet does not restore transactions or report historical hire events against the current quote request.

Saved browser progress is a recovery hint, not proof of payment. The previous job is shown with its buyer and recorded start time (or an explicit unavailable date). Recovery requires selecting **Resume job #…** with the original buyer wallet connected; it does not require a fresh quote or a prepared payment plan. This entry is available after a full reload, even when no buyer quote is active. Current chain facts must match the saved buyer, provider, network and job ID, the global evaluator/policy/token pins, and a positive funded budget matching the on-chain quoted price. Recovery never compares an old job with a new quote's description or price and never copies cached receipts into the active transaction list.

The recovery UI supports funded, submitted and completed jobs. Unfunded jobs remain accessible in job history, but this flow deliberately refuses to authorize their remaining payments with a different quote. Local seller data is only a hint: the original quote reference selects the server-side seller target, and returned chain facts must match before any notification retry. Contracts and token are always marketplace pins, never loaded from browser storage.

New journals retain their original `quoteRequestId`. Notifications and progress reporting must use that reference, not the currently displayed quote. Legacy journals without a quote reference cannot be resumed through the dynamic seller endpoint; inspect them in job history instead. Do not guess a replacement quote reference.

The latest journal pointer remains compatible with older browsers. Journals with a job ID are also archived by network, agent, buyer and job ID. Leaving a checkout detaches local UI state without deleting receipts or indexed jobs.

For sequential sends, confirmation requires a successful RPC receipt plus a transaction whose sender, target and calldata match the exact planned call. Restored jobs show their chain status separately from transaction confirmations.

Batch confirmation now resolves each unique wallet-provided hash through the pinned
RPC. The mapping must be one shared receipt or one per call; ambiguous/reverted
receipts are rejected. Creation and funding events must match the job, buyer,
provider, evaluator/hook, deadline and amount. Canonical receipt gas/block data is
passed into the journal instead of recording only hashes. Transaction row icons
are static; operation progress is shown separately. A notification failure cannot
erase confirmed payment receipts. The wallet batch ID and predicted job ID are
retained to avoid a second send on a same-checkout retry. This is not yet a claim
that every legacy pending batch can be recovered after quote expiry or reload.

For an already funded job, **Retry seller notification** re-reads chain state and calls the notification endpoint directly. It does not enter wallet execution, approve tokens or send funding again. Submitted/completed jobs do not request another notification.

Regression coverage includes fresh quotes with saved funded/submitted/completed jobs, explicit recovery, wallet changes, remounts, mismatched job descriptions/buyers, preservation of archived progress and notification failure without wallet execution. These checks use fixtures; they do not send Mainnet transactions.
