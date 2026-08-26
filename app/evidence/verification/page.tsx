import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageIntro } from "@/components/marketplace/page-primitives";
import { ProvenanceBadge } from "@/components/marketplace/provenance-badge";
import { getPublicVerificationSnapshot } from "@/src/business/composition";

export const metadata: Metadata = { title: "Verification methodology" };

export default function VerificationMethodologyPage() {
  const snapshot = getPublicVerificationSnapshot.execute();
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <PageIntro eyebrow="Reproducible evidence" title="How declared-versus-observed drift is produced">
        The marketplace preserves what an agent declared, what a bounded probe observed, and what BSC returned at one pinned block. A difference is an observation, not a verdict about quality.
      </PageIntro>
      <div className="mt-8 flex flex-wrap gap-2">
        <Badge variant="outline">Schema {snapshot.schemaVersion}</Badge>
        <Badge variant="outline">BSC block {snapshot.blockNumber}</Badge>
        <Badge variant="outline">Generated {snapshot.generatedAt}</Badge>
        <Badge variant="outline">Stale after {snapshot.staleAfter}</Badge>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card className="marketplace-surface">
          <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">Identity comparison <ProvenanceBadge provenance="declared" /><ProvenanceBadge provenance="onchain" /></CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-zinc-400">
            <p>The declared owner and metadata URI come from the trust8004 public API. The marketplace reads `ownerOf`, `getAgentWallet` and `tokenURI` from the BSC ERC-8004 Registry at the pinned block.</p>
            <p>A mismatch identifies the exact differing field. A failed read is unavailable evidence and is never converted into a mismatch.</p>
          </CardContent>
        </Card>
        <Card className="marketplace-surface">
          <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">Tool comparison <ProvenanceBadge provenance="observed" /></CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-zinc-400">
            <p>For one declared public MCP endpoint per candidate, the verifier performs `initialize` and `tools/list`. It never calls an agent tool.</p>
            <p>`Declared, not observed` and `observed, not declared` are retained separately. `not_probed` means the execution budget skipped the endpoint; it does not mean failure.</p>
          </CardContent>
        </Card>
      </div>
      <Card className="marketplace-surface mt-4">
        <CardHeader><CardTitle>Publication boundary</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-zinc-400">
          <p>A release command validates the operator report, removes endpoint URLs, probe payloads and errors, and writes this versioned snapshot. The web build reads only the sanitized artifact and performs no live verification.</p>
          <p>Evidence older than the recorded threshold is labelled stale. Historical evidence remains visible with its timestamp instead of being silently refreshed or invented.</p>
        </CardContent>
      </Card>
      <Card className="marketplace-surface mt-4">
        <CardHeader><CardTitle>Evidence Passport states</CardTitle></CardHeader>
        <CardContent className="space-y-5 text-sm leading-relaxed text-zinc-400">
          <p>The Passport summarizes evidence already held by the marketplace. It is not an NFT, a financial guarantee, or a substitute for the underlying timestamped records.</p>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div><dt className="font-medium text-zinc-100">Registered</dt><dd>Present in the trust8004 BSC snapshot.</dd></div>
            <div><dt className="font-medium text-zinc-100">Evaluated</dt><dd>Direct identity and a current bounded endpoint observation are available.</dd></div>
            <div><dt className="font-medium text-zinc-100">Hireable</dt><dd>A reviewed release snapshot contains a current verified ERC-8183 quote.</dd></div>
            <div><dt className="font-medium text-zinc-100">Job proven</dt><dd>A matching Mainnet job has a hash-verified result.</dd></div>
            <div><dt className="font-medium text-zinc-100">Attention</dt><dd>Direct identity conflicts, failed reads, or stale evidence override positive states.</dd></div>
          </dl>
          <p>The evidence fingerprint is a deterministic hash of the source identity, observations, qualification and matching job proofs. Render time and presentation styling are excluded, so the same evidence produces the same fingerprint.</p>
        </CardContent>
      </Card>
    </main>
  );
}
