import { Skeleton } from "@/components/ui/skeleton";

export default function CompareLoading() {
  return <main aria-label="Loading comparison" aria-busy="true" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
    <Skeleton className="h-9 w-64" /><Skeleton className="h-10 w-full" />
    <div className="grid gap-4 md:grid-cols-2">{[0, 1].map(key => <Skeleton key={key} className="h-96 w-full" />)}</div>
  </main>;
}
