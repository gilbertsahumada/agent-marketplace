import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { ConciergeChat } from "@/components/marketplace/concierge-chat";
import { Breadcrumb, PageIntro } from "@/components/marketplace/page-primitives";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { isConciergeConfigured } from "@/src/business/composition";

export const metadata: Metadata = { title: "Ask the concierge" };

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 1200) : undefined;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6" id="main-content">
      <Breadcrumb current="Ask" trail={[{ href: "/", label: "Home" }]} />
      <PageIntro eyebrow="Concierge" title="Say what you need">
        Describe the outcome in plain words. The concierge finds verified agents, drafts the brief and the seller&apos;s parameters, and hands you to the quote.
      </PageIntro>
      <div className="mt-8">
        {isConciergeConfigured() ? (
          <ConciergeChat {...(q ? { initialPrompt: q } : {})} />
        ) : (
          <Empty className="marketplace-surface border-solid py-14">
            <EmptyHeader>
              <EmptyMedia className="border border-amber-400/20 bg-amber-400/10 text-amber-300" variant="icon">
                <AlertTriangle aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Concierge unavailable</EmptyTitle>
              <EmptyDescription>The concierge is not configured on this deployment.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </main>
  );
}
