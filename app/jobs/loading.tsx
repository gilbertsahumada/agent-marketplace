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
          <Skeleton className="h-40 w-full rounded-xl" key={index} />
        ))}
      </div>
      <Skeleton className="mt-7 h-6 w-32" />
      <Skeleton className="mt-3 h-10 w-full" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, index) => <Skeleton className="h-14 w-full" key={index} />)}
      </div>
    </main>
  );
}
