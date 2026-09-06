import { Skeleton } from "@/components/ui/skeleton";

export default function AskLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading concierge"
      className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6"
      id="main-content"
    >
      <span className="sr-only" role="status">Loading concierge</span>
      <Skeleton className="mb-6 h-5 w-32" />
      <Skeleton className="mt-3 h-10 w-64" />
      <Skeleton className="mt-4 h-5 w-full max-w-2xl" />
      <div className="market-terminal mt-8 rounded-xl p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="mt-3 h-10 w-full" />
      </div>
    </main>
  );
}
