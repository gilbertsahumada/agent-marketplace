export type YieldRisk = "low" | "medium" | "high";

export interface YieldPlanInput {
  capital: string;
  options: string;
  riskTolerance: YieldRisk;
  maxSharePercent: number;
  minOptions: number;
}

export interface YieldOption {
  name: string;
  apyPercent: string;
  risk: YieldRisk;
}

export interface YieldConsideredOption extends YieldOption {
  eligible: boolean;
  reason: string | null;
}

export interface YieldAllocation extends YieldOption {
  sharePercent: string;
  amount: string;
}

export interface YieldPlan {
  schemaVersion: 1;
  capital: string;
  riskTolerance: YieldRisk;
  maxSharePercent: number;
  minOptions: number;
  considered: YieldConsideredOption[];
  allocations: YieldAllocation[];
  blendedApyPercent: string;
  rateSource: "provided by the buyer";
  assumptions: string[];
  execution: "none";
}
