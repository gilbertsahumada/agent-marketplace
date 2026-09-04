import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function CatalogResultsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading agents" aria-live="polite" className="grid gap-4 md:grid-cols-2" data-testid="agents-loading-results" role="status">
      <div className="col-span-full flex items-center gap-2 text-sm text-zinc-400">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
        <span>Updating agent evidence…</span>
        <span className="sr-only">Loading agents</span>
      </div>
      {Array.from({ length: count }, (_, index) => (
        <div className="marketplace-surface rounded-xl border border-white/10 p-5 sm:p-6" key={index}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="mt-5 h-5 w-40" />
          <div className="mt-6 grid grid-cols-4 gap-2 sm:gap-3">
            {Array.from({ length: 4 }, (_, step) => <Skeleton className="size-10 rounded-full" key={step} />)}
          </div>
          <Skeleton className="mt-5 h-16 rounded-lg" />
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
