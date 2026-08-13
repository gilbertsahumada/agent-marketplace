import { describe, expect, it } from "vitest";
import { buildAgentCard, extractDataPart } from "../src/seller.js";

describe("A2A seller fixture", () => {
  it("advertises exactly the skills required by the buyer", () => {
    const card = buildAgentCard("https://fixture.example") as {
      url: string;
      skills: Array<{ id: string }>;
    };
    expect(card.url).toBe("https://fixture.example/a2a");
    expect(card.skills.map(({ id }) => id)).toEqual([
      "negotiate-erc8183-job",
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
});
