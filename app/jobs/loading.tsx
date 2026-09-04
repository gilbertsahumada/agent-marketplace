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
      <div className="mt-8 flex gap-8 border-y border-border py-6">
        <Skeleton className="h-12 w-52" />
        <Skeleton className="h-12 w-52" />
      </div>
      <div className="mt-8 overflow-hidden rounded-xl border border-white/10">
        <Skeleton className="h-14 rounded-none" />
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-14 rounded-none border-t border-white/10" key={index} />)}
      </div>
    </main>
  );
}
