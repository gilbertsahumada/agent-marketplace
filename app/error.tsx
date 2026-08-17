"use client";

import { useEffect } from "react";
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

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center px-4 py-16 sm:px-6" id="main-content">
      <Empty className="marketplace-surface border-solid py-14">
        <EmptyHeader>
          <EmptyMedia className="border border-red-400/20 bg-red-400/10 text-red-300" variant="icon">
            <AlertTriangle aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Marketplace data could not be loaded</EmptyTitle>
          <EmptyDescription>
            The catalogue may be temporarily unavailable. No fallback data was invented.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Try again
          </Button>
          {error.digest && <p className="font-stat text-[10px] text-zinc-600">Reference {error.digest}</p>}
        </EmptyContent>
      </Empty>
    </main>
  );
}
