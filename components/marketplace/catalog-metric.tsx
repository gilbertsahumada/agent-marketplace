export function CatalogMetric({ label, value, unavailable = "—" }: { label: string; value: number | undefined; unavailable?: string }) {
  return (
    <div className="min-w-32">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-stat mt-1 text-xl font-medium tracking-tight text-white">
        {typeof value === "number" ? value.toLocaleString("en-US") : unavailable}
      </p>
    </div>
  );
}
