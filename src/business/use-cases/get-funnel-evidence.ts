import type { FunnelEvidence } from "../entities/funnel-evidence.ts";

export interface FunnelEvidenceReader { getLatest(): FunnelEvidence | null }

export class GetFunnelEvidence {
  constructor(private readonly reader: FunnelEvidenceReader) {}
  execute(): FunnelEvidence | null { return this.reader.getLatest(); }
}
