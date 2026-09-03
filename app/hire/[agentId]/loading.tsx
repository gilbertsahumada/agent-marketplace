import { Skeleton } from "@/components/ui/skeleton";

export default function HireAgentLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading hiring workspace"
      className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
      id="main-content"
    >
      <span className="sr-only" role="status">Loading hiring workspace</span>
      <Skeleton className="mb-6 h-5 w-40" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="rounded-2xl border border-white/10 p-7">
          <div className="flex gap-4">
            <Skeleton className="size-16 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-10 w-4/5" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
            {Array.from({ length: 3 }, (_, index) => <Skeleton className="h-10" key={index} />)}
          </div>
        </div>
        <div className="space-y-4 rounded-2xl border border-white/10 p-6">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <div className="mt-10 space-y-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    </main>
  );
}
