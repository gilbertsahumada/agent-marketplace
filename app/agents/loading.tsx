import { CatalogResultsSkeleton } from "@/components/marketplace/catalog-loading";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-[96rem] flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-7 border-b border-white/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <Skeleton className="h-11 w-64" />
        <div className="flex gap-10"><Skeleton className="h-16 w-40" /><Skeleton className="h-16 w-40" /></div>
      </header>
      <div className="mt-7 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden space-y-4 border-r border-white/10 pr-6 lg:block">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 8 }, (_, index) => <Skeleton className="h-5 w-full" key={index} />)}
          <Skeleton className="mt-8 h-4 w-20" />
          {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-5 w-full" key={index} />)}
        </aside>
        <section className="min-w-0 space-y-5">
          <div className="flex gap-2"><Skeleton className="h-10 flex-1 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div>
          <CatalogResultsSkeleton />
        </section>
      </div>
    </main>
  );
}
