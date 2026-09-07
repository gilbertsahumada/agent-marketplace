// A single non-binding quote request. No signer, wallet, job or payment calls.
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { NegotiationRequest } from "@bnbagent/sdk/erc8183";
import { discoverNegotiationInput, probeA2aSeller } from "../bnb-agent-probe/src/lib/seller-client.ts";
import { readProbeChainContext } from "../bnb-agent-probe/src/lib/chain.ts";
import { validateProbeQuote } from "../bnb-agent-probe/src/lib/quote.ts";
import { buildContractRequest } from "../src/shared/negotiation-input.ts";

const [agentId, endpoint] = process.argv.slice(2);
if (!agentId || !/^[1-9]\d*$/.test(agentId) || !endpoint) {
  throw new Error("Usage: node --import tsx scripts/verify-external-testnet-quote.ts AGENT_ID HTTPS_CARD_URL");
}
const contract = await discoverNegotiationInput({ transport: "a2a", endpoint, request: {}, fetch, timeoutMs: 10000, maxResponseBytes: 65536 });
const request = buildContractRequest(contract, {
  task_description: "Quote for a read-only explanation of health-factor monitoring on BSC Testnet. No transactions or fund management.",
  terms: { deliverables: "A short monitoring checklist", quality_standards: "Explain inputs, alerts and limitations; no transaction execution" },
});
const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://data-seed-prebsc-2-s2.binance.org:8545", { timeout: 15000, retryCount: 0 }) });
const context = await readProbeChainContext(publicClient, { agentId, chainId: 97, nowSeconds: Math.floor(Date.now() / 1000) });
const result = await probeA2aSeller({ endpoint, request, fetch, timeoutMs: 20000, maxResponseBytes: 65536, requireNotifyFunded: false });
const verdict = await validateProbeQuote(result.quote, {
  ...context, publicClient,
  nowSeconds: Math.floor(Date.now() / 1000), expectedRequest: NegotiationRequest.fromDict(request),
});
console.log(JSON.stringify({ agentId, endpoint, checkedAt: new Date().toISOString(), context, verdict }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
if (verdict.outcome !== "quote_verified") process.exitCode = 1;
