export interface HostedSellerAgentCard {
  protocolVersion: "0.3.0";
  name: string;
  description: string;
  url: string;
  preferredTransport: "JSONRPC";
  version: "1.0.0";
  capabilities: { streaming: false; pushNotifications: false; extensions?: Array<{
    uri: string;
    description: string;
    required: boolean;
    params: Record<string, unknown>;
  }> };
  defaultInputModes: ["application/json"];
  defaultOutputModes: ["application/json"];
  skills: Array<{
    id: "negotiate-erc8183-job" | "negotiate" | "notify_funded";
    name: string;
    description: string;
    tags: string[];
  }>;
}

export type HostedSellerMessage =
  | {
      skill: "negotiate-erc8183-job" | "negotiate";
      taskDescription: string;
      terms: Record<string, unknown>;
    }
  | { skill: "notify_funded"; jobId: number };

export type HostedSellerReply = Record<string, unknown>;
export type HostedSellerDeliverable = Record<string, unknown>;
