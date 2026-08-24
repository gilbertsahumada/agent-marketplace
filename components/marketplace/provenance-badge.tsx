import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProvenanceKind } from "./presentation-types";

const provenanceStyles: Record<ProvenanceKind, string> = {
  declared: "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
  observed: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  onchain: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  derived: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  not_probed: "border-zinc-600 bg-zinc-900 text-zinc-300",
};

export function ProvenanceBadge({
  provenance,
  className,
}: {
  provenance: ProvenanceKind;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-full px-2 text-[10px] font-medium capitalize",
        provenanceStyles[provenance],
        className,
      )}
    >
      {provenance}
    </Badge>
  );
}
