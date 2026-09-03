import { CatalogResultsSkeleton } from "@/components/marketplace/catalog-loading";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="marketplace-surface hidden rounded-xl p-4 lg:block">
          <div className="flex justify-between"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-14" /></div>
          {Array.from({ length: 7 }, (_, index) => <Skeleton className="mt-4 h-5 w-full" key={index} />)}
          <Skeleton className="mt-8 h-4 w-20" />
          {Array.from({ length: 4 }, (_, index) => <Skeleton className="mt-4 h-5 w-full" key={index} />)}
          <Skeleton className="mt-7 h-28 rounded-lg" />
        </aside>
        <section className="min-w-0 space-y-5">
          <div className="marketplace-surface flex h-20 items-center gap-5 rounded-xl p-3">
            <Skeleton className="h-12 w-40" /><Skeleton className="h-12 w-40" />
          </div>
          <div className="flex gap-2"><Skeleton className="h-10 flex-1 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div>
          <div className="flex gap-2 overflow-hidden">{Array.from({ length: 5 }, (_, index) => <Skeleton className="h-9 w-28 shrink-0 rounded-md" key={index} />)}</div>
          <CatalogResultsSkeleton />
        </section>
      </div>
    </main>
  );
}
