export interface LoanHealthInput {
  collateral: string;
  debt: string;
  targetHealthFactor: string;
  alertLevels: string;
}

export interface LoanHealthCollateralLine {
  asset: string;
  amount: string;
  price: string;
  value: string;
  liquidationThresholdPercent: string;
  weightedValue: string;
  liquidationPrice: string | null;
}

export interface LoanHealthDebtLine {
  asset: string;
  amount: string;
  price: string;
  value: string;
}

export type LoanHealthStatus = "no_debt" | "healthy" | "at_risk" | "liquidatable";

export interface LoanHealthAlert {
  level: string;
  state: "breached" | "clear";
  distancePercent: string;
}

export interface LoanHealthReport {
  schemaVersion: 1;
  collateral: LoanHealthCollateralLine[];
  debt: LoanHealthDebtLine[];
  totals: {
    collateralValue: string;
    weightedCollateralValue: string;
    debtValue: string;
  };
  healthFactor: string;
  status: LoanHealthStatus;
  targetHealthFactor: string;
  toReachTarget: { repayValue: string; addCollateralValue: string } | null;
  alerts: LoanHealthAlert[];
  assumptions: string[];
  execution: "none";
}
