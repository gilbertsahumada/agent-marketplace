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
      <Skeleton className="mt-3 h-10 w-64" />
      <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
      <div className="marketplace-surface mt-8 flex items-center gap-5 rounded-xl p-3 sm:gap-7">
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="mt-8 overflow-hidden rounded-xl border border-white/10">
        <Skeleton className="h-14 rounded-none" />
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-14 rounded-none border-t border-white/10" key={index} />)}
      </div>
    </main>
  );
}
