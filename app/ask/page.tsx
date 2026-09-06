import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { ConciergeChat } from "@/components/marketplace/concierge-chat";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { isConciergeConfigured } from "@/src/business/composition";

export const metadata: Metadata = { title: "Ask the concierge" };

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 1200) : undefined;
  return (
    // The chat owns the viewport under the header: no intro, no footer, the
    // composer is the page.
    <main className="flex h-[calc(100dvh-72px)] min-h-[28rem] flex-col" id="main-content">
      <h1 className="sr-only">Ask the concierge</h1>
      {isConciergeConfigured() ? (
        <ConciergeChat {...(q ? { initialPrompt: q } : {})} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4">
          <Empty className="marketplace-surface w-full max-w-lg border-solid py-14">
            <EmptyHeader>
              <EmptyMedia className="border border-amber-400/20 bg-amber-400/10 text-amber-300" variant="icon">
                <AlertTriangle aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Concierge unavailable</EmptyTitle>
              <EmptyDescription>The concierge is not configured on this deployment.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </main>
  );
}
