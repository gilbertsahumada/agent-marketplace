"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport } from "ai";
import { ArrowUpIcon, CheckIcon, CircleAlertIcon, LoaderCircleIcon, SparklesIcon, SquareIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONCIERGE_LIMITS,
  CONCIERGE_SCHEMA_VERSION,
  finalTextParts,
  isConciergeToolError,
  type ConciergeAgentCard,
  type ConciergeBrief,
  type ConciergeUIMessage,
  type ProposeOutput,
  type SearchAgentsResult,
} from "@/src/business/entities/concierge";
import type { HireabilityStatus } from "@/src/business/entities/marketplace-agent";
import { saveConciergeHandoff } from "./concierge-handoff";
import { describeConciergeError, projectConciergeMessages } from "./concierge-request";

const HIREABILITY_LABEL: Record<HireabilityStatus, string> = {
  quote_verified: "ready to quote",
  quote_stale: "quote stale",
  mcp_only: "MCP only",
  wallet_ambiguous: "wallet unclear",
  protocol_discovered: "protocol found",
  no_transport_declared: "no transport",
  not_evaluated: "not evaluated",
};

const STARTERS = [
  "A grid on BNB/USDT between 500 and 700 with 1,000 USDT and 20 levels",
  "Rebalance a small portfolio into BNB and USDT every week",
  "Watch my Venus health factor and warn me before liquidation",
];

type ConciergePart = ConciergeUIMessage["parts"][number];
type ToolPart = Extract<ConciergePart, { type: `tool-${string}` }>;

const EYEBROW = "font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";

function isToolPart(part: ConciergePart): part is ToolPart {
  return part.type.startsWith("tool-");
}

interface StepView {
  key: string;
  state: "running" | "done" | "failed";
  label: string;
}

// Turns a streamed tool part into a line a person can read, without the
// tool's name or its JSON.
function describeStep(part: ToolPart): StepView {
  const key = part.toolCallId;
  const running = part.state === "input-streaming" || part.state === "input-available";
  if (part.type === "tool-search_agents") {
    if (running) return { key, state: "running", label: "Searching the catalog…" };
    if (part.state !== "output-available" || isConciergeToolError(part.output)) {
      return { key, state: "failed", label: "The catalog did not answer" };
    }
    const { agents, label } = part.output;
    return { key, state: "done", label: `Searched the catalog · ${agents.length} ${agents.length === 1 ? "agent" : "agents"} for “${label}”` };
  }
  if (part.type === "tool-get_passport") {
    if (running) return { key, state: "running", label: "Reading the evidence passport…" };
    if (part.state !== "output-available" || isConciergeToolError(part.output)) {
      return { key, state: "failed", label: "The evidence passport is unavailable" };
    }
    return { key, state: "done", label: `Read the evidence passport of #${part.output.agentId}` };
  }
  if (part.type === "tool-get_quote_input") {
    if (running) return { key, state: "running", label: "Reading the seller's parameters…" };
    if (part.state !== "output-available" || isConciergeToolError(part.output)) {
      return { key, state: "failed", label: "The seller's parameters are unavailable" };
    }
    return { key, state: "done", label: `Read the seller's parameters of #${part.output.agentId}` };
  }
  if (running) return { key, state: "running", label: "Drafting the proposal…" };
  if (part.state !== "output-available") return { key, state: "failed", label: "The proposal could not be drafted" };
  return { key, state: "done", label: "Drafted the proposal" };
}

function StepIcon({ state }: { state: StepView["state"] }) {
  if (state === "running") return <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin text-primary" />;
  if (state === "failed") return <CircleAlertIcon aria-hidden="true" className="size-3.5 text-amber-300" />;
  return <CheckIcon aria-hidden="true" className="size-3.5 text-emerald-400" />;
}

function AgentBadge({ agent }: { agent: ConciergeAgentCard }) {
  return agent.canHire
    ? <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" variant="outline">Verified</Badge>
    : <Badge variant="outline">Listed</Badge>;
}

function Card({ label, tone = "default", children }: { label: string; tone?: "default" | "ready" | "empty"; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex w-full flex-col gap-4 rounded-2xl border p-4",
        tone === "ready" && "border-primary/40 bg-primary/5",
        tone === "empty" && "border-dashed border-border bg-transparent",
        tone === "default" && "border-border bg-background/40",
      )}
    >
      {children}
    </section>
  );
}

function BriefField({ id, label, value, rows, onChange }: { id: string; label: string; value: string; rows: number; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      <span className={EYEBROW}>{label}</span>
      <Textarea
        className="min-h-0 resize-none bg-background/60 text-sm"
        id={id}
        maxLength={CONCIERGE_LIMITS.briefChars}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function ProposalCard({ id, output, compact }: { id: string; output: ProposeOutput; compact: boolean }) {
  const router = useRouter();
  const { proposal, agents } = output;
  const agent = proposal ? agents.find((card) => card.agentId === proposal.agentId) ?? null : null;
  const fallback = agents[0] ?? null;
  const [brief, setBrief] = useState<ConciergeBrief | null>(output.brief);
  const rows = compact ? 1 : 2;

  const continueToQuote = () => {
    if (!proposal || !agent) return;
    saveConciergeHandoff(window.sessionStorage, {
      agentId: proposal.agentId,
      contractHash: proposal.contractHash,
      parameters: proposal.parameters,
      brief,
    });
    router.push(`${agent.href}#quote-request`);
  };

  return (
    <Card label={proposal ? "Proposed parameters" : "Your brief"} tone={proposal ? "ready" : "default"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={cn(EYEBROW, proposal && "text-primary")}>{proposal ? "Ready for a quote" : "Your brief"}</span>
          {agent ? (
            <span className="flex items-center gap-2 text-base font-semibold">
              {agent.name}
              <AgentBadge agent={agent} />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Edit anything below; it travels with the quote request.</span>
          )}
        </div>
      </header>
      {proposal ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {proposal.fields.map((field) => (
            <div className="flex min-w-0 flex-col gap-0.5" key={field.key}>
              <dt className="truncate text-xs text-muted-foreground">{field.title}</dt>
              <dd className="truncate font-mono text-sm tabular-nums" title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {brief ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <BriefField id={`${id}-objective`} label="Objective" onChange={(objective) => setBrief({ ...brief, objective })} rows={rows} value={brief.objective} />
          <BriefField id={`${id}-deliverable`} label="Deliverable" onChange={(deliverable) => setBrief({ ...brief, deliverable })} rows={rows} value={brief.deliverable} />
          <BriefField id={`${id}-acceptance`} label="Acceptance criteria" onChange={(acceptanceCriteria) => setBrief({ ...brief, acceptanceCriteria })} rows={rows} value={brief.acceptanceCriteria} />
        </div>
      ) : null}
      <footer className="flex flex-wrap items-center justify-between gap-3">
        {proposal && agent ? (
          <Button onClick={continueToQuote} type="button">Continue to quote with {agent.name}</Button>
        ) : fallback ? (
          <Button asChild variant="outline">
            <Link href={fallback.href}>Open {fallback.name}</Link>
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">You review every field before a quote is requested.</p>
      </footer>
    </Card>
  );
}

function AgentsCard({ agents }: { agents: ConciergeAgentCard[] }) {
  return (
    <Card label="Agents for this brief">
      <span className={EYEBROW}>Agents that match</span>
      <ol className="flex flex-col divide-y divide-border">
        {agents.map((agent) => (
          <li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={agent.agentId}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate">{agent.name}</span>
                <AgentBadge agent={agent} />
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {[...agent.categories.map((category) => category.replaceAll("_", " ")), HIREABILITY_LABEL[agent.hireability]].join(" · ")}
              </span>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href={agent.href}>Open</Link>
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function NoMatchCard() {
  return (
    <Card label="No matching agents" tone="empty">
      <span className={EYEBROW}>No matching agents</span>
      <p className="text-sm text-muted-foreground">Nothing in the catalog covers this yet. The verified agents run grid trading, rebalancing, yield and health factor monitoring on BNB Chain.</p>
      <Button asChild className="w-fit" size="sm" variant="outline">
        <Link href="/agents?view=marketplace">Browse verified agents</Link>
      </Button>
    </Card>
  );
}

function ThinkingRow() {
  return (
    <span aria-label="The concierge is thinking" className="inline-flex items-center gap-1 py-1" role="status">
      {[0, 150, 300].map((delay) => (
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" key={delay} style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

function AssistantTurn({ message, streaming, compact }: { message: ConciergeUIMessage; streaming: boolean; compact: boolean }) {
  const toolParts = message.parts.filter(isToolPart);
  const steps = toolParts.map(describeStep);
  // Only the text after the last tool call is the reply; narration before a
  // tool call would duplicate the step rows.
  const textParts = finalTextParts(message.parts).filter((part) => part.text.length > 0);
  const proposePart = toolParts.find((part) => part.type === "tool-propose");
  const propose = proposePart?.type === "tool-propose" && proposePart.state === "output-available" ? proposePart.output : null;
  let lastSearch: SearchAgentsResult | null = null;
  for (const part of toolParts) {
    if (part.type === "tool-search_agents" && part.state === "output-available" && !isConciergeToolError(part.output)) {
      lastSearch = part.output;
    }
  }
  const showAgents = !propose?.proposal && (propose?.agents ?? lastSearch?.agents ?? []).length > 0;
  const showNoMatch = lastSearch !== null && lastSearch.agents.length === 0 && !propose;

  return (
    <Message from="assistant">
      <span className={EYEBROW}>Concierge</span>
      {steps.length > 0 ? (
        <ul aria-label="Steps" className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          {steps.map((step) => (
            <li className="flex items-center gap-2" key={step.key}>
              <StepIcon state={step.state} />
              <span>{step.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {textParts.length > 0 ? (
        <MessageContent className="text-[15px] leading-relaxed">
          {textParts.map((part, index) => (
            <MessageResponse isAnimating={streaming} key={index}>{part.text}</MessageResponse>
          ))}
        </MessageContent>
      ) : streaming ? (
        <ThinkingRow />
      ) : null}
      {propose && (propose.proposal || propose.brief) ? <ProposalCard compact={compact} id={message.id} output={propose} /> : null}
      {showAgents ? <AgentsCard agents={propose?.agents ?? lastSearch!.agents} /> : null}
      {showNoMatch ? <NoMatchCard /> : null}
    </Message>
  );
}

function UserTurn({ message }: { message: ConciergeUIMessage }) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
  return (
    <Message from="user">
      <span className={cn(EYEBROW, "text-right")}>You</span>
      <MessageContent className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</MessageContent>
    </Message>
  );
}

export interface ConciergeChatProps {
  initialPrompt?: string;
  compact?: boolean;
  placeholder?: string;
  /** Test seam: replaces the HTTP transport to /api/marketplace/concierge. */
  transport?: ChatTransport<ConciergeUIMessage>;
}

export function ConciergeChat({
  initialPrompt,
  compact = false,
  placeholder = "Describe what you need, in your own words.",
  transport,
}: ConciergeChatProps) {
  const chatTransport = useMemo(
    () =>
      transport
      ?? new DefaultChatTransport<ConciergeUIMessage>({
        api: "/api/marketplace/concierge",
        // The route takes text only; tool outputs stay in the browser.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { schemaVersion: CONCIERGE_SCHEMA_VERSION, messages: projectConciergeMessages(messages) },
        }),
      }),
    [transport],
  );
  const { messages, sendMessage, status, error, stop, regenerate } = useChat<ConciergeUIMessage>({ transport: chatTransport });
  const [draft, setDraft] = useState("");
  const sentInitial = useRef(false);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!initialPrompt || sentInitial.current) return;
    sentInitial.current = true;
    void sendMessage({ text: initialPrompt });
  }, [initialPrompt, sendMessage]);

  const submit = (text: string) => {
    const trimmed = text.trim().slice(0, CONCIERGE_LIMITS.userChars);
    if (!trimmed || busy) return;
    setDraft("");
    void sendMessage({ text: trimmed });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  };

  const lastIndex = messages.length - 1;

  return (
    <section
      aria-label="Concierge"
      className={cn(
        "marketplace-surface flex flex-col overflow-hidden rounded-2xl",
        compact ? "h-[28rem]" : "h-[min(70vh,46rem)] min-h-[30rem]",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2">
          <SparklesIcon aria-hidden="true" className="size-4 text-primary" />
          <span className={cn(EYEBROW, "text-foreground")}>Concierge</span>
        </span>
        <span aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", busy ? "animate-pulse bg-primary" : error ? "bg-amber-300" : "bg-emerald-400")}
          />
          {busy ? "Thinking" : error ? "Interrupted" : "Ready"}
        </span>
      </header>

      <Conversation className="flex-1">
        <ConversationContent className={cn("gap-6", compact ? "p-4" : "p-4 sm:p-6")}>
          {messages.length === 0 ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold tracking-tight">Say what you need.</h3>
                <p className="max-w-prose text-sm text-muted-foreground">
                  The concierge searches the verified catalog, drafts the brief and fills the seller&apos;s parameters. You get to the quote in one step.
                </p>
              </div>
              <Suggestions aria-label="Examples">
                {STARTERS.map((starter) => (
                  <Suggestion key={starter} onClick={submit} suggestion={starter} />
                ))}
              </Suggestions>
            </div>
          ) : null}
          {messages.map((message, index) =>
            message.role === "user" ? (
              <UserTurn key={message.id} message={message} />
            ) : (
              <AssistantTurn compact={compact} key={message.id} message={message} streaming={busy && index === lastIndex} />
            ),
          )}
          {status === "submitted" && messages[lastIndex]?.role === "user" ? (
            <Message from="assistant">
              <span className={EYEBROW}>Concierge</span>
              <ThinkingRow />
            </Message>
          ) : null}
          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm" role="alert">
              <span>{describeConciergeError(error)}</span>
              <Button onClick={() => void regenerate()} size="sm" type="button" variant="outline">Try again</Button>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <form aria-label="Ask the concierge" className="border-t border-border p-3" onSubmit={onSubmit}>
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background/60 p-1.5 transition-colors focus-within:border-ring">
          <Textarea
            aria-label="Your request"
            className="field-sizing-content max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-[15px] shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
            maxLength={CONCIERGE_LIMITS.userChars}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={compact ? 1 : 2}
            value={draft}
          />
          {busy ? (
            <Button aria-label="Stop" onClick={() => void stop()} size="icon" type="button" variant="outline">
              <SquareIcon aria-hidden="true" className="size-3.5" />
            </Button>
          ) : (
            <Button aria-label="Send" disabled={draft.trim().length === 0} size="icon" type="submit">
              <ArrowUpIcon aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span className="tabular-nums">{draft.length}/{CONCIERGE_LIMITS.userChars}</span>
        </div>
      </form>
      {!compact ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          The concierge drafts. You review every field before a quote is requested; the signed quote sets the price and the escrow holds your funds.
        </p>
      ) : null}
    </section>
  );
}
