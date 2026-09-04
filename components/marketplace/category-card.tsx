import Link from "next/link";
import {
  CandlestickChart,
  ChevronRight,
  HeartPulse,
  RefreshCw,
  Sprout,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CategoryCardViewModel,
  MarketplaceCategory,
} from "./presentation-types";

const categoryIcons = {
  rebalancing: RefreshCw,
  grid_trading: CandlestickChart,
  yield_optimisation: Sprout,
  health_factor_monitoring: HeartPulse,
} satisfies Record<MarketplaceCategory, typeof RefreshCw>;

export function CategoryCard({ category }: { category: CategoryCardViewModel }) {
  const Icon = categoryIcons[category.category];
  const isEmpty = category.availability === "empty";

  return (
    <Card className="marketplace-surface h-full gap-4 rounded-2xl py-6 transition-colors hover:border-primary/45">
      <CardHeader className="gap-3 px-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <Badge
            variant="outline"
            className={
              isEmpty
                ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            }
          >
            {category.availabilityLabel}
          </Badge>
        </div>
        <div>
          <CardTitle className="text-lg">{category.title}</CardTitle>
          <CardDescription className="mt-2 leading-relaxed">
            {category.description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto px-5">
        <Link
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
          href={category.href}
        >
          {isEmpty ? "View coverage gap" : "Browse candidates"}
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
