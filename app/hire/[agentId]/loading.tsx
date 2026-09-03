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
      <div className="flex flex-col gap-5 border-y border-white/10 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-40" />
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border border-white/10">
          <Skeleton className="h-64 rounded-none" />
          {Array.from({ length: 3 }, (_, index) => <Skeleton className="h-16 rounded-none border-t border-white/10" key={index} />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="mt-8 h-28 rounded-xl" />
    </main>
  );
}
