import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function CatalogUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <main className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center px-4 py-16 sm:px-6" id="main-content">
      <Empty className="marketplace-surface border-solid py-14">
        <EmptyHeader>
          <EmptyMedia className="border border-amber-400/20 bg-amber-400/10 text-amber-300" variant="icon">
            <AlertTriangle aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Live catalogue temporarily unavailable</EmptyTitle>
          <EmptyDescription>
            The marketplace evidence service did not finish this request. No agent status or profile data was invented.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={retryHref}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Return to marketplace status</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
