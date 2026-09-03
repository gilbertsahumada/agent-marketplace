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
      <div className="mt-6 rounded-xl border border-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-44" />
          </div>
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="flex items-start gap-3" key={index}>
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="mt-5 h-3 w-72 max-w-full" />
      </div>
      <div className="mt-6 rounded-xl border border-white/10 p-4 sm:p-5">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="mt-2 h-4 w-3/4 max-w-full" />
        {Array.from({ length: 2 }, (_, index) => (
          <div className="mt-4 rounded-xl border border-white/10 p-4" key={index}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-8 w-40" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-40 rounded-xl" />
      <Skeleton className="mt-8 h-28 rounded-xl" />
    </main>
  );
}
