import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center px-4 py-16 sm:px-6" id="main-content">
      <Empty className="marketplace-surface border-solid py-14">
        <EmptyHeader>
          <EmptyMedia className="border border-white/10 bg-white/[0.03] text-zinc-300" variant="icon">
            <SearchX aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>This marketplace page does not exist</EmptyTitle>
          <EmptyDescription>
            The agent or job may have moved, or the identifier may be incorrect.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href="/agents">
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back to agents
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}
