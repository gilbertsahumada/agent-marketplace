import {describe,expect,it} from 'vitest';
import {marketplaceStatus,agentJourneyAction,availabilityHistory} from '../components/marketplace/agent-card';
import type {AgentCardViewModel} from '../components/marketplace/presentation-types';

const agent:AgentCardViewModel={agentId:'42',name:'Seller',description:'Service',operator:'third_party',categories:[],href:'/hire/42',hireability:'listed_only',passportState:'evaluated',quoteRequestAvailable:true,buyerAction:'request_quote',evidence:[]};
describe('current eligibility is separate from quote history',()=>{
  it.each(['ready','stale','failed','discovered'] as const)('labels requestable %s evidence as available',capabilityState=>{
    expect(marketplaceStatus({...agent,capabilityState}).label).toBe('Available to quote');
  });
  it.each(['suspended','unsupported'] as const)('never labels %s evidence as available',capabilityState=>{
    expect(marketplaceStatus({...agent,capabilityState}).label).toBe('Not available');
  });
  it('does not advertise expired eligibility',()=>{
    expect(marketplaceStatus({...agent,quoteRequestAvailable:false,buyerAction:'check_availability',capabilityState:'stale'}).label).not.toBe('Available to quote');
  });
  it('honors an explicit negative flag even with an inconsistent legacy action',()=>{
    const denied={...agent,quoteRequestAvailable:false,capabilityState:'ready' as const,evidence:[{kind:'reachable' as const,label:'Connection',status:'verified' as const,provenance:'observed' as const,detail:'Reachable'}]};
    expect(marketplaceStatus(denied).label).toBe('Check availability');
    expect(agentJourneyAction(denied).label).toBe('Check availability');
  });
  it('does not turn a historical failure into a current restriction',()=>{
    const current={...agent,evidence:[{kind:'reachable' as const,label:'Earlier check',status:'failed' as const,provenance:'observed' as const,detail:'Older check',timestamp:'2026-09-27T00:00:00Z'}]};
    expect(marketplaceStatus(current).label).toBe('Available to quote');
    expect(agentJourneyAction(current).label).toBe('Request quote');
  });
  it('keeps current failures unavailable',()=>{
    const current={...agent,quoteRequestAvailable:false,buyerAction:'check_availability' as const,evidence:[{kind:'reachable' as const,label:'Current check',status:'failed' as const,provenance:'observed' as const,detail:'Failed'}]};
    expect(marketplaceStatus(current).label).toBe('Connection failed');
    expect(agentJourneyAction(current).label).toBe('Check availability');
  });
  it('does not offer hiring without the buyer quote action',()=>{
    expect(agentJourneyAction({...agent,capabilityState:'ready'}).label).toBe('Request quote');
  });
  it('retains historical failures with their date and separates present eligibility',()=>{
    const note=availabilityHistory({...agent,capabilityState:'failed',lastQuoteAttemptAt:'2026-09-27T10:00:00Z'});
    expect(note).toContain('Previous quote attempt failed');
    expect(note).toContain('27 Sept 2026');
    expect(note).toContain('Current requirements allow a new quote request');
  });
  it('does not invent missing dates',()=>{
    expect(availabilityHistory({...agent,capabilityState:'stale'})).toContain('date unavailable');
  });
});
