export interface FunnelEvidence {
  sourcePath: string;
  sourceSha256: string;
  generatedAt: string;
  blockNumber: string;
  registeredTotal: number;
  metadataOk: number;
  transportDeclarants: number;
  publicHttpsEndpoints: number;
  erc8183Declarants: number;
}
