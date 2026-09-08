import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function CatalogResultsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading agents" aria-live="polite" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="agents-loading-results" role="status">
      <div className="col-span-full flex items-center gap-2 text-sm text-zinc-400">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
        <span>Loading services…</span>
        <span className="sr-only">Loading agents</span>
      </div>
      {Array.from({ length: count }, (_, index) => (
        <div className="space-y-4" key={index}>
          <Skeleton className="aspect-[1.65] w-full rounded-xl" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" />
          </div>
          <Skeleton className="h-3 w-28" />
          <div className="flex justify-between gap-3 border-t border-white/10 pt-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}
