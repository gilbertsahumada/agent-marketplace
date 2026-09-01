import { Skeleton } from "@/components/ui/skeleton";

export function CatalogResultsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading agents" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="agents-loading-results" role="status">
      <span className="sr-only">Loading agents</span>
      {Array.from({ length: count }, (_, index) => (
        <div className="rounded-xl border border-white/10 p-5" key={index}>
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="mt-5 h-5 w-32" />
          <div className="mt-6 flex justify-between gap-3">
            {Array.from({ length: 4 }, (_, step) => <Skeleton className="size-10 rounded-full" key={step} />)}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
