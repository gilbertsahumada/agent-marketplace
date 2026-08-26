import type {
  HostedSellerAgentCard,
  HostedSellerDeliverable,
  HostedSellerMessage,
  HostedSellerReply,
} from "../../business/entities/hosted-erc8183-seller.ts";

export interface HostedErc8183SellerRepository {
  getAgentCard(): Promise<HostedSellerAgentCard>;
  handleMessage(message: HostedSellerMessage): Promise<HostedSellerReply>;
  getDeliverable(jobId: bigint): Promise<HostedSellerDeliverable>;
}
