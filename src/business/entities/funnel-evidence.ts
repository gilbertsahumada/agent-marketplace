export interface FunnelEvidence {
  sourcePath: string;
  sourceSha256: string;
  generatedAt: string;
  blockNumber: string;
  registeredTotal: number;
  countOnlyTotal: number;
  scanDurationMs: number;
  metadataOk: number;
  transportDeclarants: number;
  publicHttpsEndpoints: number;
  erc8183Declarants: number;
}
