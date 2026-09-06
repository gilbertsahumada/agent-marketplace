import { Skeleton } from "@/components/ui/skeleton";

export default function AskLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading concierge"
      className="flex h-[calc(100dvh-72px)] min-h-[28rem] flex-col items-center justify-center px-4"
      id="main-content"
    >
      <span className="sr-only" role="status">Loading concierge</span>
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="mt-8 h-[7.5rem] w-full max-w-3xl rounded-[28px]" />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Skeleton className="h-8 w-56 rounded-full" />
        <Skeleton className="h-8 w-44 rounded-full" />
        <Skeleton className="h-8 w-48 rounded-full" />
      </div>
    </main>
  );
}
