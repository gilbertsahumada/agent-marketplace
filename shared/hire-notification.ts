export type NotificationState = "pending" | "processing" | "sending" | "uncertain" | "notified" | "watching" | "delivered" | "stopped" | "attention";
export interface HireNotification {
  chainId: 56 | 97;
  jobId: string;
  agentId: string;
  quoteRequestId: number;
  buyer: string;
  state: NotificationState;
  attempts: number;
  nextAttemptAt: number;
  leaseToken: string | null;
  leaseUntil: number;
  updatedAt: number;
}
export const NOTIFICATION_LABELS: Record<NotificationState, string> = {
  pending: "Notification pending", processing: "Checking notification", sending: "Sending notification",
  uncertain: "Checking agent response", notified: "Agent notified", watching: "Awaiting agent · no notification endpoint",
  delivered: "Delivery submitted", stopped: "Notification stopped · job closed or expired", attention: "Notification needs attention",
};
