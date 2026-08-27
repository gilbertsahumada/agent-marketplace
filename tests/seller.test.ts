import { describe, expect, it } from "vitest";
import { JobStatus } from "@bnbagent/sdk/erc8183";
import {
  buildAgentCard,
  extractDataPart,
  fundedNotificationDisposition,
  assertFixtureAgentOwner,
} from "../src/seller.ts";

describe("A2A seller fixture", () => {
  it("advertises both accepted negotiation skill identifiers and notify_funded", () => {
    const card = buildAgentCard("https://fixture.example") as {
      url: string;
      skills: Array<{ id: string }>;
    };
    expect(card.url).toBe("https://fixture.example/a2a");
    expect(card.skills.map(({ id }) => id)).toEqual([
      "negotiate-erc8183-job",
      "negotiate",
      "notify_funded",
    ]);
  });

  it("extracts an A2A JSON-RPC data part", () => {
    expect(
      extractDataPart({
        jsonrpc: "2.0",
        id: "request-1",
        method: "message/send",
        params: {
          message: {
            parts: [
              { kind: "data", data: { skill: "notify_funded", job_id: 7 } },
            ],
          },
        },
      }),
    ).toEqual({
      id: "request-1",
      data: { skill: "notify_funded", job_id: 7 },
    });
  });

  it("makes notify_funded idempotent after submission", () => {
    expect(fundedNotificationDisposition(JobStatus.FUNDED)).toBe("submit");
    expect(fundedNotificationDisposition(JobStatus.SUBMITTED)).toBe("already_submitted");
    expect(fundedNotificationDisposition(JobStatus.COMPLETED)).toBe("already_submitted");
    expect(fundedNotificationDisposition(JobStatus.OPEN)).toBe("reject");
  });

  it("updates fixture metadata only through the registered owner", () => {
    const owner = "0x0000000000000000000000000000000000000001";
    expect(() => assertFixtureAgentOwner(owner, owner)).not.toThrow();
    expect(() =>
      assertFixtureAgentOwner(
        owner,
        "0x0000000000000000000000000000000000000002",
      ),
    ).toThrow(/not the owner/);
  });
});
