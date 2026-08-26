import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redact, writeReceipt, type Gate1Receipt } from "../src/receipt.ts";

describe("Gate 1 receipts", () => {
  it("recursively removes secret-shaped fields", () => {
    expect(
      redact({
        ok: true,
        authorization: "Bearer hidden",
        nested: { clientSecret: "hidden", result: "kept" },
      }),
    ).toEqual({ ok: true, nested: { result: "kept" } });
    expect(redact("request failed with Bearer hidden-value")).toBe(
      "[REDACTED]",
    );
  });

  it("writes an atomic redacted receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gate1-receipt-"));
    const path = join(directory, "receipt.json");
    const receipt: Gate1Receipt = {
      schemaVersion: 1,
      sdkVersion: "0.5.0",
      updatedAt: "old",
      phase: "test",
      chainId: 97,
      notification: { accessToken: "hidden", accepted: true },
    };
    await writeReceipt(path, receipt);
    const written = await readFile(path, "utf8");
    expect(written).not.toContain("hidden");
    expect(JSON.parse(written).notification).toEqual({ accepted: true });
  });
});
