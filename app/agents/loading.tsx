import { CatalogResultsSkeleton } from "@/components/marketplace/catalog-loading";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-[96rem] flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-3"><Skeleton className="h-10 w-3/5" /><Skeleton className="h-4 w-2/5" /></div>
      <div className="flex gap-3"><Skeleton className="h-10 flex-1 rounded-lg" /><Skeleton className="h-10 w-32 rounded-lg" /><Skeleton className="h-10 w-20 rounded-lg" /></div>
      <CatalogResultsSkeleton />
    </main>
  );
}
