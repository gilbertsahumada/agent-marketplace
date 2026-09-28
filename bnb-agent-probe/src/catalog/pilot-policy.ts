/** Legacy cohorts retained for repeatable seeding. New membership lives in D1. */
export const ORIGINAL_PILOT_AGENT_IDS = ['341565','341564','341563','303779','213378','213332','213053','212989','212840','208760','265375','269233','270213'] as const;
export const PILOT_EXPANSION_AGENT_IDS = ['204789','212769','212943','213036','213084','213432'] as const;
export const PILOT_AGENT_IDS = [...ORIGINAL_PILOT_AGENT_IDS,...PILOT_EXPANSION_AGENT_IDS] as const;
const keys = new Set<string>(PILOT_AGENT_IDS.map(id=>`eip155:56:${id}`));
/** Legacy membership only; not the admission predicate for new work. */
export function isPilotAgent(key:string):boolean { return keys.has(key); }
/** Syntax only, NOT admission. Durable membership is enforced by the agenda FK. */
export function isPilotAgentKey(key:string):boolean { return /^eip155:56:[1-9][0-9]{0,77}$/.test(key); }
export const PILOT_ADMISSION_LIMIT=29;
export const PILOT_BATCH_LIMIT=10;
// Conservative headroom for a producer and consumer reservation per member.
export const PILOT_RENEWAL_HEADROOM=29*2*155_000;
export function pilotRenewalDelay(key:string):number {
  if (!isPilotAgentKey(key)) throw new Error('PILOT_AGENT_NOT_ALLOWED');
  let hash=2166136261;
  for (const char of key) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  return 22*3_600_000+(hash%3_600_001);
}
