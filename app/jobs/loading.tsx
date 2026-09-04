import { Skeleton } from "@/components/ui/skeleton";

export default function JobsLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading jobs ledger"
      className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
      id="main-content"
    >
      <span className="sr-only" role="status">Loading jobs ledger</span>
      <Skeleton className="mb-6 h-5 w-32" />
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-3 h-10 w-80" />
      <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <div className="mt-8 overflow-hidden rounded-xl border border-white/10">
        <Skeleton className="h-14 rounded-none" />
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-14 rounded-none border-t border-white/10" key={index} />)}
      </div>
    </main>
  );
}
