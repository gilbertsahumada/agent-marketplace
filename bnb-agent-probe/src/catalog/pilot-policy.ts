/** Fixed, explicitly authorized pilot. No environment variable can widen it. */
export const ORIGINAL_PILOT_AGENT_IDS = ['341565','341564','341563','303779','213378','213332','213053','212989','212840','208760','265375','269233','270213'] as const;
export const PILOT_EXPANSION_AGENT_IDS = ['204789','212769','212943','213036','213084','213432'] as const;
export const PILOT_AGENT_IDS = [...ORIGINAL_PILOT_AGENT_IDS,...PILOT_EXPANSION_AGENT_IDS] as const;
const keys = new Set<string>(PILOT_AGENT_IDS.map(id=>`eip155:56:${id}`));
export function isPilotAgent(key:string):boolean { return keys.has(key); }
export function pilotRenewalDelay(key:string):number {
  if (!isPilotAgent(key)) throw new Error('PILOT_AGENT_NOT_ALLOWED');
  let hash=2166136261;
  for (const char of key) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  return 22*3_600_000+(hash%3_600_001);
}
