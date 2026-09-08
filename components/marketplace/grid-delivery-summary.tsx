import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function parseGridDelivery(content: string) {
  let value;
  try { value = JSON.parse(content); } catch { return null; }
  const decimal = (v: unknown) => typeof v === "string" && /^\d+(\.\d+)?$/.test(v);
  if (!value || value.schemaVersion !== 1 || value.execution !== "none"
    || typeof value.pair !== "string" || !decimal(value.lowerPrice) || !decimal(value.upperPrice)
    || !decimal(value.capital) || !Array.isArray(value.levels) || value.levels.length > 100
    || value.levels.length < 1 || value.gridCount !== value.levels.length
    || !value.levels.every((level: { index?: unknown; price?: unknown; capital?: unknown; side?: unknown }) => level
      && Number.isInteger(level.index) && decimal(level.price) && decimal(level.capital)
      && (level.side === "buy" || level.side === "sell"))) return null;
  return value;
}

export function GridDeliverySummary({ content }: { content: string }) {
  const value = parseGridDelivery(content);
  if (!value) return null;
  return <section aria-label="Grid plan" className="flex flex-col gap-3">
    <h3 className="font-medium">Grid plan · {value.pair}</h3>
    <p className="text-sm">Range {value.lowerPrice}–{value.upperPrice} · {value.gridCount} levels · Simulated capital {value.capital}</p>
    <p className="text-sm text-muted-foreground">Simulation only. No orders were placed and no trading capital was invested.</p>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Level</TableHead><TableHead>Price</TableHead><TableHead>Side</TableHead><TableHead>Simulated allocation</TableHead></TableRow></TableHeader>
        <TableBody>{value.levels.map((level: { index: number; price: string; side: string; capital: string }, index: number) =>
          <TableRow key={index}><TableCell>{level.index}</TableCell><TableCell>{level.price}</TableCell><TableCell>{level.side}</TableCell><TableCell>{level.capital}</TableCell></TableRow>)}</TableBody>
      </Table>
    </div>
  </section>;
}
