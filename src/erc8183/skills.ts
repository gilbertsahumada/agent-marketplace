/**
 * Skill identifiers observed in ERC-8183 A2A Agent Cards.
 *
 * The BNB examples use `negotiate-erc8183-job`, while third-party cards in
 * the wild use the shorter `negotiate`. Both names describe the same
 * negotiation message; accepting both keeps discovery interoperable without
 * weakening the separate `notify_funded` requirement.
 */
export const ERC8183_NEGOTIATION_SKILL_IDS = [
  "negotiate-erc8183-job",
  "negotiate",
] as const;

export type Erc8183NegotiationSkill = typeof ERC8183_NEGOTIATION_SKILL_IDS[number];

export const ERC8183_NOTIFY_FUNDED_SKILL_ID = "notify_funded" as const;

export function negotiationSkillForCard(
  skills: readonly { id: string }[],
): Erc8183NegotiationSkill | null {
  return ERC8183_NEGOTIATION_SKILL_IDS.find((id) => skills.some((skill) => skill.id === id)) ?? null;
}

export function hasErc8183SellerSkills(
  skills: readonly { id: string }[],
): boolean {
  return negotiationSkillForCard(skills) !== null
    && skills.some((skill) => skill.id === ERC8183_NOTIFY_FUNDED_SKILL_ID);
}
