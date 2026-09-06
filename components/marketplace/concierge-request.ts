import type { UIMessage } from "ai";
import { CONCIERGE_LIMITS, finalTextParts, type ConciergeMessage } from "@/src/business/entities/concierge";

/**
 * Projects the chat's UI messages (text plus streamed tool parts) onto the
 * text-only history the concierge route accepts: alternating user/assistant
 * turns, at most 12, bounded per role, ending with the user's new message.
 * Tool outputs stay in the browser; the server re-searches every request so
 * a proposal can only name agents that came back from that same search.
 */
export function projectConciergeMessages(messages: ReadonlyArray<Pick<UIMessage, "role" | "parts">>): ConciergeMessage[] {
  const merged: ConciergeMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = finalTextParts(message.parts)
      .map((part) => part.text)
      .join("")
      .trim();
    if (!content) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      merged.push({ role: message.role, content });
    }
  }

  while (merged.length > 0 && merged[0]!.role !== "user") merged.shift();
  let recent = merged.slice(-CONCIERGE_LIMITS.messages);
  if (recent.length > 0 && recent[0]!.role !== "user") recent = recent.slice(1);

  return recent.map((message) => ({
    role: message.role,
    content: message.content.slice(0, message.role === "user" ? CONCIERGE_LIMITS.userChars : CONCIERGE_LIMITS.assistantChars),
  }));
}

export const CONCIERGE_ERROR_COPY = {
  busy: "The concierge is busy right now. Try again in a moment.",
  offline: "The concierge is offline right now.",
  generic: "The concierge could not answer. Try again.",
} as const;

// useChat surfaces two kinds of failures: a non-2xx response, whose body
// (our {error:{code,message}} JSON) becomes the Error message, and an error
// chunk mid-stream, whose text the use case already wrote for people. Only
// those known strings reach the screen; anything else is a generic notice.
export function describeConciergeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  try {
    const parsed = JSON.parse(message) as { error?: { code?: unknown } };
    const code = parsed?.error?.code;
    if (code === "MarketplaceRateLimitError") return CONCIERGE_ERROR_COPY.busy;
    if (code === "MarketplaceDataUnavailableError") return CONCIERGE_ERROR_COPY.offline;
    return CONCIERGE_ERROR_COPY.generic;
  } catch {
    // Not JSON: a stream error text.
  }
  return /^(The concierge|This took too long)/.test(message) ? message : CONCIERGE_ERROR_COPY.generic;
}
