import { AsciiClouds } from "@/components/marketplace/ascii-clouds";
import { Skeleton } from "@/components/ui/skeleton";

export default function JobsLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading jobs ledger"
      className="mx-auto w-full max-w-[1480px] flex-1 px-5 py-8 sm:px-8 lg:px-12"
      id="main-content"
    >
      <span className="sr-only" role="status">Loading jobs ledger</span>
      <Skeleton className="mb-6 h-5 w-32" />
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-4 h-5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-64" />
      </div>
      <div className="mt-7 flex items-center gap-3">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="jobs-activity-card relative overflow-hidden rounded-xl border p-4" key={index}>
            <AsciiClouds className="jobs-activity-ascii-clouds" />
            <div className="relative z-10">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-8 w-16" />
              <Skeleton className="mt-5 h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-7 h-6 w-32" />
      <Skeleton className="mt-3 h-10 w-full" />
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
        <Skeleton className="h-14 rounded-none" />
        {Array.from({ length: 7 }, (_, index) => <Skeleton className="h-14 rounded-none border-t border-white/10" key={index} />)}
      </div>
    </main>
  );
}
