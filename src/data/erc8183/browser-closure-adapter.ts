import { createPublicClient, createWalletClient, custom, encodeFunctionData, isAddressEqual, parseAbi, type EIP1193Provider, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { ERC8183_MAINNET as pins } from "../../mainnet/contracts.ts";
import { mainnetImplementationPinsMatch } from "../../mainnet/implementation-pins.ts";
import { closeHireJob, type ClosureAction, type ClosureAttempt, type ClosurePort } from "../../business/use-cases/close-hire-job.ts";

const abi = parseAbi(["function dispute(uint256 jobId)", "function settle(uint256 jobId, bytes evidence)"]);
// Exact wire signatures from the installed SDK ABI; no server SDK imported into the browser.
const readAbi = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))",
  "function jobPolicy(uint256 jobId) view returns (address)",
  "function disputeWindow() view returns (uint256)",
  "function disputed(uint256 jobId) view returns (bool)",
  "function check(uint256 jobId,bytes evidence) view returns (uint8,bytes32)",
]);
const statuses = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"];

/** Explicit Mainnet adapter. Never swaps Testnet IDs onto Mainnet contracts. */
export async function executeBrowserClosure(input: { provider: unknown; wallet: string; jobId: string; action: ClosureAction; mode: "send" | "resume" }) {
  if (!/^[1-9]\d{0,19}$/.test(input.jobId) || !/^0x[\da-f]{40}$/i.test(input.wallet) ||
    !input.provider || typeof (input.provider as EIP1193Provider).request !== "function") throw new Error("Invalid wallet or job");
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate closure attempts");
  const provider = input.provider as EIP1193Provider;
  const wallet = input.wallet as Address;
  const p = createPublicClient({ chain: bsc, transport: custom(provider, { retryCount: 0 }) });
  const w = createWalletClient({ chain: bsc, account: wallet, transport: custom(provider, { retryCount: 0 }) });
  const id = BigInt(input.jobId);
  const address = input.action === "dispute" ? pins.policy : pins.router;
  const data = input.action === "dispute" ? encodeFunctionData({ abi, functionName: "dispute", args: [id] }) : encodeFunctionData({ abi, functionName: "settle", args: [id, "0x"] });
  const binding = { chainId: 56, commerce: pins.commerce, wallet, jobId: input.jobId, action: input.action };
  const key = `marketplace:closure:v1:56:${pins.commerce.toLowerCase()}:${id}:${wallet.toLowerCase()}:${input.action}`;
  const getJob = () => p.readContract({ address: pins.commerce, abi: readAbi, functionName: "getJob", args: [id] });
  const disputedNow = () => p.readContract({ address: pins.policy, abi: readAbi, functionName: "disputed", args: [id] });
  const port: ClosurePort = {
    exclusive: async run => await navigator.locks.request(key, { ifAvailable: true }, lock => {
      if (!lock) throw new Error("This job has an active closure operation in another tab");
      return run();
    }),
    load: () => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const saved = JSON.parse(raw) as ClosureAttempt;
      if (!saved || !["signing", "submitted", "confirmed", "reverted", "uncertain", "rejected"].includes(saved.state) ||
        (saved.hash !== undefined && !/^0x[\da-f]{64}$/i.test(saved.hash))) throw new Error("Invalid saved closure; inspect wallet history");
      return saved;
    },
    save: attempt => localStorage.setItem(key, JSON.stringify(attempt)),
    assertWallet: async () => {
      const [chain, accounts] = await Promise.all([p.getChainId(), w.getAddresses()]);
      if (chain !== 56 || !accounts[0] || !isAddressEqual(accounts[0], wallet)) throw new Error("Wallet or network changed");
    },
    read: async () => {
      if (await p.getChainId() !== 56 || !await mainnetImplementationPinsMatch(p)) throw new Error("Contract verification failed");
      const [job, boundPolicy, block, window, disputed, verdict] = await Promise.all([
        getJob(), p.readContract({ address: pins.router, abi: readAbi, functionName: "jobPolicy", args: [id] }), p.getBlock(), p.readContract({ address: pins.policy, abi: readAbi, functionName: "disputeWindow" }), disputedNow(), p.readContract({ address: pins.policy, abi: readAbi, functionName: "check", args: [id, "0x"] }),
      ]);
      return { status: statuses[job.status] ?? "UNKNOWN", buyer: job.client, supported: isAddressEqual(job.evaluator, pins.router) && isAddressEqual(boundPolicy, pins.policy), disputed, verdict: verdict[0], now: block.timestamp, reviewEndsAt: job.submittedAt + window };
    },
    simulate: async () => { await p.call({ account: wallet, to: address, data }); },
    send: async () => w.sendTransaction({ account: wallet, to: address, data, value: 0n }),
    verify: async hash => {
      if (await p.getChainId() !== 56 || !await mainnetImplementationPinsMatch(p)) throw new Error("Wrong network or changed contracts");
      const receipt = await p.waitForTransactionReceipt({ hash: hash as Hex, timeout: 45_000, confirmations: 1 });
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Transaction was replaced; inspect the replacement before continuing");
      const tx = await p.getTransaction({ hash: hash as Hex });
      if (!tx.to || !isAddressEqual(tx.to, address) || !isAddressEqual(tx.from, wallet) || tx.input.toLowerCase() !== data.toLowerCase() || tx.value !== 0n) throw new Error("Receipt does not belong to this closure");
      if (receipt.status === "reverted") return "reverted";
      if (input.action === "dispute") return await disputedNow() ? "confirmed" : "pending";
      const job = await getJob();
      return job.status === 3 || job.status === 4 ? "confirmed" : "pending";
    },
  };
  return closeHireJob(binding, port, input.mode);
}
