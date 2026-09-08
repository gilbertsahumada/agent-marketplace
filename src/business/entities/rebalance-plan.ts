export interface RebalancePlanInput {
  positions: string;
  targets: string;
  driftThresholdPercent: number;
}

export type RebalanceAction = "hold" | "buy" | "sell";

export interface RebalancePosition {
  asset: string;
  amount: string;
  price: string;
  value: string;
  currentWeightPercent: string;
  targetWeightPercent: string;
  driftPercent: string;
  action: RebalanceAction;
  tradeAmount: string;
  tradeValue: string;
}

export interface RebalanceTrade {
  asset: string;
  side: "buy" | "sell";
  amount: string;
  value: string;
}

export interface RebalancePlan {
  schemaVersion: 1;
  quoteUnit: "price units as provided";
  totalValue: string;
  positions: RebalancePosition[];
  trades: RebalanceTrade[];
  driftThresholdPercent: number;
  assumptions: string[];
  execution: "none";
}
