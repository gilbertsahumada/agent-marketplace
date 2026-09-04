import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  funnelEvidenceFromArtifact,
  funnelEvidenceRepository,
} from "../src/data/observation/funnel-evidence-repository.ts";

const ARTIFACT_PATH = "evidence/funnel-bsc-2026-09-04T19-31-44Z.json";

function artifact(): Record<string, unknown> {
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
}

describe("funnel evidence repository", () => {
  it("loads the versioned WP0 artifact and preserves its counts", () => {
    const raw = artifact();
    const evidence = funnelEvidenceRepository.getLatest();
    expect(evidence).not.toBeNull();
    expect(evidence!.sourcePath).toBe(ARTIFACT_PATH);
    expect(evidence!.sourceSha256).toBe(raw.sourceSha256);
    expect(evidence!.generatedAt).toBe(raw.generatedAt);
    expect(evidence!.blockNumber).toBe((raw.cutoff as { blockNumber: string }).blockNumber);
    expect(evidence!.registeredTotal).toBe(raw.registeredTotal);
    expect(evidence!.countOnlyTotal).toBe(raw.countOnlyTotal);
    expect(evidence!.scanDurationMs).toBe((raw.scan as { durationMs: number }).durationMs);
    expect(evidence!.metadataOk).toBe((raw.metadata as { ok: number }).ok);
    const protocols = raw.protocols as { erc8183Only: number; both: number };
    expect(evidence!.erc8183Declarants).toBe(protocols.erc8183Only + protocols.both);
    const candidates = raw.candidates as { declaringAgents: number; publicHttpsEndpoints: number };
    expect(evidence!.transportDeclarants).toBe(candidates.declaringAgents);
    expect(evidence!.publicHttpsEndpoints).toBe(candidates.publicHttpsEndpoints);
  });

  it("publishes only a complete, internally consistent latest sweep", () => {
    const raw = artifact() as {
      registeredTotal: number;
      countOnlyTotal: number;
      scan: {
        duplicateAgentIds: number;
        errors: string[];
        http429Responses: number;
        missingRegisteredAt: number;
      };
      gates: Array<{ name: string; passed: boolean }>;
    };

    expect(raw.scan.duplicateAgentIds).toBe(0);
    expect(raw.scan.missingRegisteredAt).toBe(0);
    expect(raw.scan.http429Responses).toBe(0);
    expect(raw.scan.errors).toEqual([]);
    expect(Math.abs(raw.registeredTotal - raw.countOnlyTotal) / raw.countOnlyTotal).toBeLessThan(0.01);
    expect(raw.gates.filter((gate) => gate.name !== "wp1SizingWithinBudget").every((gate) => gate.passed)).toBe(true);
  });

  it("rejects an artifact whose counts were tampered with", () => {
    const raw = artifact();
    raw.registeredTotal = (raw.registeredTotal as number) + 1;
    expect(funnelEvidenceFromArtifact(raw, ARTIFACT_PATH)).toBeNull();
  });

  it("rejects an artifact whose sha256 does not reproduce", () => {
    const raw = artifact();
    const metadata = raw.metadata as { ok: number; httpUnreachable: number };
    metadata.ok += 1;
    metadata.httpUnreachable -= 1;
    expect(funnelEvidenceFromArtifact(raw, ARTIFACT_PATH)).toBeNull();
  });

  it("rejects non-artifact input", () => {
    expect(funnelEvidenceFromArtifact(null, ARTIFACT_PATH)).toBeNull();
    expect(funnelEvidenceFromArtifact([], ARTIFACT_PATH)).toBeNull();
    expect(funnelEvidenceFromArtifact({ schemaVersion: 2 }, ARTIFACT_PATH)).toBeNull();
  });
});
