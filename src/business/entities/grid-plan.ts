export interface GridPlanInput {
  pair: string;
  lowerPrice: string;
  upperPrice: string;
  capital: string;
  gridCount: number;
}

export interface GridLevel {
  index: number;
  price: string;
  side: "buy" | "sell";
  capital: string;
}

export interface GridPlan {
  schemaVersion: 1;
  pair: string;
  lowerPrice: string;
  upperPrice: string;
  capital: string;
  gridCount: number;
  spacing: string;
  levels: GridLevel[];
  rebalanceTriggers: { below: string; above: string };
  assumptions: string[];
  execution: "none";
}
