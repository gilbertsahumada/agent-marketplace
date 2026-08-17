import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading marketplace" id="main-content">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <span className="sr-only" role="status">Loading marketplace</span>
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="space-y-5">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-14 w-full max-w-2xl sm:h-28" />
            <Skeleton className="h-6 w-full max-w-xl" />
            <div className="flex gap-3">
              <Skeleton className="h-11 w-36" />
              <Skeleton className="h-11 w-44" />
            </div>
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="marketplace-surface space-y-4 rounded-xl p-5" key={index}>
              <div className="flex justify-between">
                <Skeleton className="size-10 rounded-xl" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
