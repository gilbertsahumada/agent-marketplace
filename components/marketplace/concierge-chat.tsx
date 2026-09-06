"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CONCIERGE_LIMITS,
  CONCIERGE_SCHEMA_VERSION,
  type ConciergeAgentCard,
  type ConciergeBrief,
  type ConciergeMessage,
  type ConciergeProposal,
  type ConciergeReply,
  type ConciergeStep,
} from "@/src/business/entities/concierge";
import type { HireabilityStatus } from "@/src/business/entities/marketplace-agent";
import { saveConciergeHandoff } from "./concierge-handoff";

const HIREABILITY_LABEL: Record<HireabilityStatus, string> = {
  quote_verified: "ready to quote",
  quote_stale: "quote stale",
  mcp_only: "MCP only",
  wallet_ambiguous: "wallet unclear",
  protocol_discovered: "protocol found",
  no_transport_declared: "no transport",
  not_evaluated: "not evaluated",
};

const GENERIC_ERROR = "The concierge could not answer. Try again.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConciergeBrief(value: unknown): value is ConciergeBrief {
  return isPlainObject(value)
    && typeof value.objective === "string"
    && typeof value.deliverable === "string"
    && typeof value.acceptanceCriteria === "string";
}

function isConciergeAgentCard(value: unknown): value is ConciergeAgentCard {
  return isPlainObject(value)
    && typeof value.agentId === "string"
    && typeof value.name === "string"
    && Array.isArray(value.categories)
    && typeof value.hireability === "string"
    && typeof value.canHire === "boolean"
    && (value.summary === null || typeof value.summary === "string")
    && typeof value.href === "string";
}

function isConciergeProposal(value: unknown): value is ConciergeProposal {
  return isPlainObject(value)
    && typeof value.agentId === "string"
    && isPlainObject(value.parameters)
    && typeof value.contractHash === "string"
    && Array.isArray(value.fields);
}

function isConciergeStep(value: unknown): value is ConciergeStep {
  return isPlainObject(value) && typeof value.tool === "string" && typeof value.summary === "string";
}

// Defensive: the route already validates its own output, but a client must
// never trust a 200 body blindly. Anything short of this shape degrades to
// the generic error copy instead of crashing the render.
function parseConciergeReply(value: unknown): ConciergeReply | null {
  if (!isPlainObject(value) || typeof value.message !== "string") return null;
  if (value.question !== null && typeof value.question !== "string") return null;
  if (value.brief !== null && !isConciergeBrief(value.brief)) return null;
  if (!Array.isArray(value.agents) || !value.agents.every(isConciergeAgentCard)) return null;
  if (value.proposal !== null && !isConciergeProposal(value.proposal)) return null;
  if (!Array.isArray(value.steps) || !value.steps.every(isConciergeStep)) return null;

  return {
    schemaVersion: 1,
    message: value.message,
    question: (value.question as string | null) ?? null,
    brief: (value.brief as ConciergeBrief | null) ?? null,
    agents: value.agents as ConciergeAgentCard[],
    proposal: (value.proposal as ConciergeProposal | null) ?? null,
    steps: value.steps as ConciergeStep[],
    model: typeof value.model === "string" ? value.model : "",
  };
}

// Mirrors parseConciergeBrief / isValidConciergeBrief (concierge-handoff.ts):
// a brief edited past the shared limit must degrade to null instead of being
// saved as-is, otherwise takeConciergeHandoff rejects the whole hand-off
// (parameters included) on the receiving end.
function briefIsComplete(brief: ConciergeBrief | null): brief is ConciergeBrief {
  return brief !== null
    && [brief.objective, brief.deliverable, brief.acceptanceCriteria].every(
      (field) => field.trim().length > 0 && field.length <= CONCIERGE_LIMITS.briefChars
    );
}

function windowMessages(messages: ConciergeMessage[]): ConciergeMessage[] {
  // The route rejects a history longer than CONCIERGE_LIMITS.messages, and
  // requires it to start and end on a "user" turn, so pairs must be dropped
  // from the front (never a lone message) to keep the alternation valid.
  let windowed = messages;
  while (windowed.length > CONCIERGE_LIMITS.messages) {
    windowed = windowed.slice(2);
  }
  return windowed;
}

export interface ConciergeChatProps {
  placeholder?: string;
  initialPrompt?: string;
  compact?: boolean;
}

// The chat only ever drafts: a brief, candidate agents and seller
// parameters. Requesting the signed quote still happens on the seller's own
// form (`quote-request-panel.tsx`), which is what actually locks price and
// escrow — this component just hands it a starting point.
export function ConciergeChat({ placeholder, initialPrompt, compact = false }: ConciergeChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ConciergeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<ConciergeReply | null>(null);
  const [briefDraft, setBriefDraft] = useState<ConciergeBrief | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sentInitialRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || status === "sending") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // A newer send (a real user submit, or the re-armed StrictMode retry
    // below) always replaces abortRef.current before this one settles; only
    // a request that is still "current" when it fails should touch state —
    // otherwise it would stomp on the request that superseded it.
    const isCurrent = () => abortRef.current === controller;

    const previousMessages = messagesRef.current;
    const nextMessages: ConciergeMessage[] = [...previousMessages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setStatus("sending");
    setError(null);

    try {
      const response = await fetch("/api/marketplace/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: CONCIERGE_SCHEMA_VERSION, messages: windowMessages(nextMessages) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (!isCurrent()) return;
        // Roll back the optimistic user turn: leaving it in place would make
        // the next send start with two consecutive "user" messages, which
        // the route always rejects (it requires strict alternation).
        setMessages(previousMessages);
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          setError(
            retryAfter && /^\d+$/.test(retryAfter)
              ? `The concierge is busy. Try again in ${retryAfter} s.`
              : "The concierge is busy. Try again in a moment."
          );
        } else if (response.status === 503) {
          setError("The concierge is offline right now.");
        } else {
          setError(GENERIC_ERROR);
        }
        setStatus("error");
        return;
      }

      const parsed = parseConciergeReply(await response.json());
      if (!isCurrent()) return;
      if (parsed === null) {
        setMessages(previousMessages);
        setError(GENERIC_ERROR);
        setStatus("error");
        return;
      }

      setReply(parsed);
      if (parsed.brief !== null) setBriefDraft(parsed.brief);
      setMessages((current) => [...current, { role: "assistant", content: parsed.message }]);
      setStatus("idle");
    } catch (caught) {
      if (!isCurrent()) return; // superseded: the newer request owns state now
      if (caught instanceof DOMException && caught.name === "AbortError") {
        // Not superseded, so this abort came from the unmount-cleanup effect
        // below rather than a newer send (React StrictMode runs that cleanup
        // between its double-invoked mounts). Recover instead of leaving the
        // chat stuck on "sending" with an optimistic turn that would break
        // the next request's alternation.
        setMessages(previousMessages);
        setStatus("idle");
        return;
      }
      setMessages(previousMessages);
      setError(GENERIC_ERROR);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!initialPrompt || sentInitialRef.current) return;
    sentInitialRef.current = true;
    void sendMessage(initialPrompt);
    return () => {
      // React StrictMode (next.config.ts reactStrictMode) mounts, cleans up
      // and mounts again in development; the cleanup above aborts the first
      // attempt, so this guard must reset too, or the second mount silently
      // skips resending the initial prompt.
      sentInitialRef.current = false;
    };
    // Runs once on mount for the given initialPrompt; sendMessage reads live
    // state through refs, so it does not need to be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  function updateBriefField(field: keyof ConciergeBrief, value: string) {
    setBriefDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function handleContinue(proposal: ConciergeProposal, agent: ConciergeAgentCard | null) {
    const href = agent?.href ?? `/hire/${proposal.agentId}`;
    try {
      saveConciergeHandoff(window.sessionStorage, {
        agentId: proposal.agentId,
        contractHash: proposal.contractHash,
        parameters: proposal.parameters,
        brief: briefIsComplete(briefDraft) ? briefDraft : null,
      });
    } catch {
      // Storage may throw (quota, private mode); still route the buyer on.
    }
    router.push(`${href}#quote-request`);
  }

  const proposalAgent = reply?.proposal ? reply.agents.find((candidate) => candidate.agentId === reply.proposal!.agentId) ?? null : null;
  const firstAgent = reply?.agents[0] ?? null;

  return (
    <div className={compact ? "concierge concierge--compact" : "concierge market-terminal"}>
      <ol aria-label="Conversation" className="concierge__list">
        {messages.map((message, index) => (
          <li className="concierge__message" data-role={message.role} key={`${message.role}-${index}`}>
            {message.content}
          </li>
        ))}
      </ol>

      {reply ? (
        <>
          {reply.steps.length > 0 ? (
            <ul aria-label="Steps" className="concierge__steps">
              {reply.steps.map((step, index) => (
                <li key={`${step.tool}-${index}`}>{step.tool} · {step.summary}</li>
              ))}
            </ul>
          ) : null}

          {briefDraft ? (
            <section aria-label="Your brief" className="concierge__brief">
              <label>
                Objective
                <Input
                  maxLength={CONCIERGE_LIMITS.briefChars}
                  onChange={(event) => updateBriefField("objective", event.target.value)}
                  value={briefDraft.objective}
                />
              </label>
              <label>
                Deliverable
                <Textarea
                  maxLength={CONCIERGE_LIMITS.briefChars}
                  onChange={(event) => updateBriefField("deliverable", event.target.value)}
                  rows={2}
                  value={briefDraft.deliverable}
                />
              </label>
              <label>
                Acceptance criteria
                <Textarea
                  maxLength={CONCIERGE_LIMITS.briefChars}
                  onChange={(event) => updateBriefField("acceptanceCriteria", event.target.value)}
                  rows={2}
                  value={briefDraft.acceptanceCriteria}
                />
              </label>
            </section>
          ) : null}

          {reply.agents.length > 0 ? (
            <ol aria-label="Agents for this brief" className="concierge__agents">
              {reply.agents.map((agent) => (
                <li className="concierge__agent-row" key={agent.agentId}>
                  <span>
                    <strong>{agent.name}</strong>
                    <span className="concierge__agent-meta">
                      {agent.categories.map((category) => category.replaceAll("_", " ")).join(", ") || "not classified"}
                      {" · "}
                      {HIREABILITY_LABEL[agent.hireability]}
                    </span>
                  </span>
                  <Badge variant={agent.canHire ? "default" : "secondary"}>{agent.canHire ? "verified" : "listed"}</Badge>
                  <Link href={agent.href}>Open<span className="sr-only"> {agent.name}</span></Link>
                </li>
              ))}
            </ol>
          ) : null}

          {reply.proposal ? (
            <section aria-label="Proposed parameters" className="concierge__proposal">
              <dl>
                {reply.proposal.fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.title}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
              <Button onClick={() => handleContinue(reply.proposal!, proposalAgent)} type="button">
                Continue to quote with {proposalAgent?.name ?? reply.proposal.agentId}
              </Button>
            </section>
          ) : firstAgent ? (
            <Button asChild type="button" variant="outline">
              <Link href={firstAgent.href}>Open {firstAgent.name}</Link>
            </Button>
          ) : null}
        </>
      ) : null}

      {reply?.question ? <p className="concierge__question">{reply.question}</p> : null}

      <form aria-label="Ask the concierge" className="concierge__form" onSubmit={handleSubmit}>
        <Textarea
          aria-label="Message"
          disabled={status === "sending"}
          maxLength={CONCIERGE_LIMITS.userChars}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Describe what you need — plain words are fine."}
          rows={compact ? 2 : 3}
          value={draft}
        />
        <Button disabled={status === "sending" || draft.trim().length === 0} type="submit">
          Ask
        </Button>
      </form>

      <p aria-live="polite" className="concierge__status" role="status">
        {status === "sending" ? "Asking the concierge…" : (error ?? "")}
      </p>

      <p className="concierge__note">
        The concierge drafts. You review every field before a quote is requested; the signed quote sets the price and
        the escrow holds your funds.
      </p>
    </div>
  );
}
