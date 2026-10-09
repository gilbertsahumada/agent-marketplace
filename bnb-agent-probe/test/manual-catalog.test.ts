import { expect, it } from 'vitest';
import { deriveCatalogEvidenceState, selectBestCapability, type CapabilityFact } from '../src/catalog/evidence-policy';

const checked = 1791426604824;
const key = 'fa19c2da6083ae5d5b3828f270706ff28e041bb94e773ff94b8fa6de213b9b05';
const capability: CapabilityFact = {
  agentKey: 'eip155:56:303779', endpointKey: key, state: 'ready', transport: 'a2a',
  compatibilityState: 'compatible', schemaHash: 'valid', compatibilityCheckedAt: checked,
  compatibilityExpiresAt: checked + 86400000, capabilityExpiresAt: checked + 86400000,
};
const endpoints = [{ endpointKey: key, role: 'operational', eligibility: 'eligible', validationProtocol: 'a2a' }];
function state(overrides: Partial<CapabilityFact> = {}, observations: Parameters<typeof deriveCatalogEvidenceState>[0]['observations'] = [], endpointRows = endpoints) {
  return deriveCatalogEvidenceState({ endpoints: endpointRows, observations, admission: null,
    capability: { ...capability, ...overrides }, nowMs: checked + 365 * 86400000 });
}

it('keeps the manually selected endpoint requestable after expiry without faking freshness or hire permission', () => {
  const before = structuredClone(capability);
  expect(state()).toMatchObject({ canRequestQuote: true, canPrepareHire: false, buyerAction: 'request_quote',
    capabilityState: 'stale', compatibilityExpiresAt: checked + 86400000, freshness: 'never' });
  expect(capability).toEqual(before);
  expect(selectBestCapability([capability], checked + 365 * 86400000, { endpoints, observations: [] })?.endpointKey).toBe(key);
});

it('does not admit other agents, networks, endpoints, unverified requirements or older evidence', () => {
  for (const overrides of [{agentKey:'eip155:97:303779'}, {agentKey:'eip155:56:270213'},
    {endpointKey:'replacement'}, {schemaHash:null}, {compatibilityState:'pending'},
    {compatibilityCheckedAt: checked - 1}, {compatibilityCheckedAt:null},
    {state:'suspended' as const}, {state:'unsupported' as const}]) {
    expect(state(overrides).canRequestQuote, JSON.stringify(overrides)).toBe(false);
  }
  expect(state({}, [], [{...endpoints[0]!, eligibility:'unsafe'}]).canRequestQuote).toBe(false);
  expect(state({}, [], []).canRequestQuote).toBe(false);
});

it('blocks a failure after the saved check and never treats another buyer quote as hire permission', () => {
  expect(state({}, [{id:1,endpointKey:key,source:'buyer_refresh',outcome:'network_error',
    observedAt:checked+1,expiresAt:null,validationKind:'protocol',verificationLevel:'platform_observed'}]).canRequestQuote).toBe(false);
  expect(state({}, [{id:2,endpointKey:key,source:'buyer',outcome:'quote_verified',
    observedAt:checked,expiresAt:checked+400*86400000,validationKind:'quote',verificationLevel:'cryptographic'}]).canPrepareHire).toBe(false);
});
