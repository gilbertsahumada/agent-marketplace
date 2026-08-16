import type {
  CategoryClassification,
  CategoryEvidence,
  MarketplaceCategory,
  Trust8004Profile,
} from "./types.js";

interface Rule {
  category: MarketplaceCategory;
  textSignals: RegExp[];
  toolSignals: RegExp[];
  minimumTools: number;
}

const RULES: Rule[] = [
  {
    category: "rebalancing",
    textSignals: [/concentrated liquidity/i, /price range/i, /\brebalanc/i, /tick spacing/i],
    toolSignals: [
      /increaseLiquidity/i,
      /decreaseLiquidity/i,
      /collectFees/i,
      /estimateRanges/i,
      /getLpPosition/i,
    ],
    minimumTools: 3,
  },
  {
    category: "grid_trading",
    textSignals: [/\bgrid(?: trading)?\b/i, /grid (?:order|level|spacing)/i],
    toolSignals: [/createGrid/i, /cancelOrder/i, /reprice/i, /gridOrder/i, /placeOrder/i],
    minimumTools: 2,
  },
  {
    category: "yield_optimisation",
    textSignals: [/\byield\b/i, /\bvault/i, /\bapr\b/i, /\bapy\b/i, /yield optim/i],
    toolSignals: [/deposit/i, /withdraw/i, /getVault/i, /getSupplyAPR/i, /migrate/i, /stake/i],
    minimumTools: 2,
  },
  {
    category: "health_factor_monitoring",
    textSignals: [/health factor/i, /health indicator/i, /liquidation/i, /collateral/i, /borrow(?:ing)? power/i],
    toolSignals: [
      /getUserHealth/i,
      /getAccountLiquidity/i,
      /getUserCollateral/i,
      /getUserBorrowingPower/i,
      /repay/i,
      /liquidation/i,
    ],
    minimumTools: 2,
  },
];

function firstMatch(value: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function classifyWithRule(profile: Trust8004Profile, rule: Rule): CategoryClassification | null {
  const evidence: CategoryEvidence[] = [];
  const descriptionMatch = firstMatch(profile.description ?? "", rule.textSignals);
  const nameMatch = firstMatch(profile.name, rule.textSignals);
  if (nameMatch) {
    evidence.push({
      category: rule.category,
      kind: "declared",
      sourcePath: "profile.agent.name",
      signal: "keyword",
      value: nameMatch,
    });
  }
  if (descriptionMatch) {
    evidence.push({
      category: rule.category,
      kind: "declared",
      sourcePath: "profile.agent.description",
      signal: "keyword",
      value: descriptionMatch,
    });
  }

  const toolEvidence = profile.services.flatMap((service, serviceIndex) =>
    service.tools.flatMap((tool) => {
      const match = firstMatch(tool, rule.toolSignals);
      return match
        ? [{
            category: rule.category,
            kind: "declared" as const,
            sourcePath: `profile.agent.services[${serviceIndex}].tools`,
            signal: "tool-name",
            value: tool,
          }]
        : [];
    }),
  );
  evidence.push(...toolEvidence);

  const hasTextSignal = Boolean(nameMatch || descriptionMatch);
  if (!hasTextSignal || toolEvidence.length < rule.minimumTools) return null;
  return {
    category: rule.category,
    confidence: Math.min(0.95, 0.5 + evidence.length * 0.08),
    evidence,
    verified: false,
  };
}

export function classifyProfile(profile: Trust8004Profile): CategoryClassification[] {
  return RULES.flatMap((rule) => {
    const classification = classifyWithRule(profile, rule);
    return classification ? [classification] : [];
  });
}
