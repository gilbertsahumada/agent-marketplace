import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { HostedErc8183SellerRepository } from "../src/data/repositories/hosted-erc8183-seller-repository.ts";
import { GetHostedSellerDeliverable } from "../src/business/use-cases/get-hosted-seller-deliverable.ts";
import { HandleHostedSellerMessage } from "../src/business/use-cases/handle-hosted-seller-message.ts";
import { hostedSellerAgentCard } from "../src/business/policies/hosted-seller-policy.ts";
import { loadHostedSellerConfig } from "../src/data/erc8183/hosted-seller-config.ts";
import { parseHostedSellerRequest } from "../src/presentation/http/hosted-seller-http.ts";

const testPrivateKey = `0x${"11".repeat(32)}` as const;

function repository(
  overrides: Partial<HostedErc8183SellerRepository> = {},
): HostedErc8183SellerRepository {
  return {
    getAgentCard: async () => hostedSellerAgentCard("https://seller.example"),
    handleMessage: async () => ({ accepted: true }),
    getDeliverable: async (jobId) => ({ success: true, job_id: Number(jobId) }),
    ...overrides,
  };
}

function rpcRequest(data: Record<string, unknown>): Request {
  return new Request("https://seller.example/api/fixtures/erc8183/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "request-1",
      method: "message/send",
      params: {
        message: { parts: [{ kind: "data", data }] },
      },
    }),
  });
}

describe("hosted ERC-8183 seller", () => {
  it("builds a public card with both accepted negotiation skill identifiers", () => {
    const card = hostedSellerAgentCard("https://seller.example");
    expect(card.url).toBe("https://seller.example/api/fixtures/erc8183/a2a");
    expect(card.description).toContain("not a marketplace agent");
    expect(card.skills.map(({ id }) => id)).toEqual([
      "negotiate-erc8183-job",
      "negotiate",
      "notify_funded",
    ]);
  });

  it("derives the server seller address without exposing the key", () => {
    const config = loadHostedSellerConfig({
      SELLER_PRIVATE_KEY: testPrivateKey,
      ERC8183_BROWSER_SPIKE_SELLER_ORIGIN: "https://seller.example",
    });
    expect(config.address).toBe(
      getAddress(privateKeyToAccount(testPrivateKey).address),
    );
    expect(config.origin).toBe("https://seller.example");
  });

  it("rejects missing keys and unsafe origins", () => {
    expect(() => loadHostedSellerConfig({})).toThrow(/SELLER_PRIVATE_KEY/);
    expect(() =>
      loadHostedSellerConfig({
        SELLER_PRIVATE_KEY: testPrivateKey,
        ERC8183_BROWSER_SPIKE_SELLER_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow(/bare HTTPS origin/);
  });

  it("parses negotiation and notification without accepting arbitrary skills", async () => {
    await expect(
      parseHostedSellerRequest(
        rpcRequest({
          skill: "negotiate-erc8183-job",
          task_description: "Deterministic echo",
          terms: { deliverables: "text" },
        }),
      ),
    ).resolves.toMatchObject({
      id: "request-1",
      message: { skill: "negotiate-erc8183-job" },
    });
    await expect(
      parseHostedSellerRequest(
        rpcRequest({
          skill: "negotiate",
          task_description: "Deterministic echo",
          terms: { deliverables: "text" },
        }),
      ),
    ).resolves.toMatchObject({
      id: "request-1",
      message: { skill: "negotiate" },
    });
    await expect(
      parseHostedSellerRequest(
        rpcRequest({ skill: "notify_funded", job_id: 900 }),
      ),
    ).resolves.toMatchObject({
      message: { skill: "notify_funded", jobId: 900 },
    });
    await expect(
      parseHostedSellerRequest(rpcRequest({ skill: "transfer_funds" })),
    ).rejects.toThrow(/Unknown/);
  });

  it("delegates messages and deliverables to exactly one repository method", async () => {
    const handleMessage = vi.fn().mockResolvedValue({ accepted: true });
    const getDeliverable = vi.fn().mockResolvedValue({ success: true });
    const repo = repository({ handleMessage, getDeliverable });
    const message = new HandleHostedSellerMessage(repo);
    const deliverable = new GetHostedSellerDeliverable(repo);
    await message.execute({
      skill: "negotiate-erc8183-job",
      taskDescription: "echo",
      terms: {},
    });
    await deliverable.execute({ jobId: "900" });
    expect(handleMessage).toHaveBeenCalledOnce();
    expect(getDeliverable).toHaveBeenCalledOnce();
    expect(getDeliverable).toHaveBeenCalledWith(900n);
  });

  it("rejects invalid job ids before infrastructure", async () => {
    const getDeliverable = vi.fn();
    const useCase = new GetHostedSellerDeliverable(repository({ getDeliverable }));
    expect(() => useCase.execute({ jobId: "0" })).toThrow(/positive integer/);
    expect(getDeliverable).not.toHaveBeenCalled();
  });
});
