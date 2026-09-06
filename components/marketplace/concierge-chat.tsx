"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport } from "ai";
import {
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  PenLineIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Suggestion } from "@/components/ai-elements/suggestion";
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
import { useTypewriter } from "./use-typewriter";

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

// The column every part of the chat lines up on, like a chat app: the
// conversation, the composer and the note under it share one measure.
const COLUMN = "mx-auto w-full max-w-3xl px-4 sm:px-6";

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
  icon: LucideIcon;
}

// One glyph per kind of work, so a glance says what the concierge is doing.
const STEP_ICON: Record<string, LucideIcon> = {
  "tool-search_agents": SearchIcon,
  "tool-get_passport": ShieldCheckIcon,
  "tool-get_quote_input": SlidersHorizontalIcon,
  "tool-propose": PenLineIcon,
};

// Turns a streamed tool part into a line a person can read, without the
// tool's name or its JSON.
function describeStep(part: ToolPart, streaming: boolean): StepView {
  const step = describeStepText(part);
  const icon = STEP_ICON[part.type] ?? PenLineIcon;
  if (step.state === "running" && !streaming) {
    // The turn is over (Stop, or a dropped stream) with this call unanswered.
    const activity = step.label.replace(/…$/, "");
    return { ...step, state: "failed", label: `Stopped while ${activity.charAt(0).toLowerCase()}${activity.slice(1)}`, icon };
  }
  return { ...step, icon: step.state === "failed" ? CircleAlertIcon : icon };
}

function describeStepText(part: ToolPart): Omit<StepView, "icon"> {
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

function briefIsComplete(brief: ConciergeBrief | null): brief is ConciergeBrief {
  return brief !== null && [brief.objective, brief.deliverable, brief.acceptanceCriteria].every((field) => field.trim().length > 0);
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
        "flex w-full flex-col gap-4 rounded-3xl border p-5",
        tone === "ready" && "border-primary/40 bg-primary/[0.06]",
        tone === "empty" && "border-dashed border-border bg-transparent",
        tone === "default" && "border-border bg-card/60",
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
        className="field-sizing-content max-h-40 min-h-0 resize-none rounded-xl bg-background/60 text-sm"
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
    // The quote panel rejects a half-empty brief together with everything
    // else in the handoff; the parameters matter more, so the brief travels
    // only when complete.
    saveConciergeHandoff(window.sessionStorage, {
      agentId: proposal.agentId,
      contractHash: proposal.contractHash,
      parameters: proposal.parameters,
      brief: briefIsComplete(brief) ? brief : null,
    });
    router.push(`${agent.href}#quote-request`);
  };

  return (
    <Card label={proposal ? "Proposed parameters" : "Your brief"} tone={proposal ? "ready" : "default"}>
      <header className="flex flex-col gap-1">
        <span className={cn(EYEBROW, proposal && "text-primary")}>{proposal ? "Ready for a quote" : "Your brief"}</span>
        {agent ? (
          <span className="flex items-center gap-2 text-base font-semibold">
            {agent.name}
            <AgentBadge agent={agent} />
          </span>
        ) : null}
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
      {proposal && agent ? (
        <Button className="self-start rounded-full" onClick={continueToQuote} type="button">Continue to quote with {agent.name}</Button>
      ) : fallback ? (
        <Button asChild className="self-start rounded-full" variant="outline">
          <Link href={fallback.href}>Open {fallback.name}</Link>
        </Button>
      ) : null}
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
            <Button asChild className="rounded-full" size="sm" variant="ghost">
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
    // The reply already says what the catalog covers, in the person's
    // language; the card only offers the way out.
    <Card label="No matching agents" tone="empty">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={EYEBROW}>No matching agents</span>
        <Button asChild className="rounded-full" size="sm" variant="outline">
          <Link href="/agents?view=marketplace">Browse verified agents</Link>
        </Button>
      </div>
    </Card>
  );
}

// The pulsing dot a chat shows before the first token arrives.
function ThinkingDot() {
  return <span aria-label="The concierge is thinking" className="concierge-dot my-2 block" role="status" />;
}

function Steps({ steps }: { steps: StepView[] }) {
  return (
    <ul aria-label="Steps" className="flex flex-col gap-1 text-[13px] text-muted-foreground">
      {steps.map((step) => (
        <li className={cn("flex items-center gap-2", step.state === "failed" && "text-amber-300")} key={step.key}>
          <step.icon
            aria-hidden="true"
            className={cn("size-3.5 shrink-0", step.state === "running" && "concierge-step-pulse text-foreground")}
          />
          {step.state === "running" ? <span className="concierge-shimmer">{step.label}</span> : <span>{step.label}</span>}
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      aria-label={copied ? "Copied" : "Copy"}
      className="size-7 rounded-md text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      {copied ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
    </Button>
  );
}

interface AssistantTurnProps {
  message: ConciergeUIMessage;
  streaming: boolean;
  last: boolean;
  compact: boolean;
  onRetry: () => void;
}

function AssistantTurn({ message, streaming, last, compact, onRetry }: AssistantTurnProps) {
  const toolParts = message.parts.filter(isToolPart);
  const steps = toolParts.map((part) => describeStep(part, streaming));
  // Only the text after the last tool call is the reply; narration before a
  // tool call would duplicate the step rows.
  const textParts = finalTextParts(message.parts).filter((part) => part.text.length > 0);
  const text = textParts.map((part) => part.text).join("");
  const proposePart = toolParts.find((part) => part.type === "tool-propose");
  const propose = proposePart?.type === "tool-propose" && proposePart.state === "output-available" ? proposePart.output : null;
  let lastSearch: SearchAgentsResult | null = null;
  for (const part of toolParts) {
    if (part.type === "tool-search_agents" && part.state === "output-available" && !isConciergeToolError(part.output)) {
      lastSearch = part.output;
    }
  }
  // The cards wait for the turn to finish: a search result is not the answer
  // while the concierge is still reading parameters or drafting.
  const showAgents = !streaming && !propose?.proposal && (propose?.agents ?? lastSearch?.agents ?? []).length > 0;
  const showNoMatch = !streaming && lastSearch !== null && lastSearch.agents.length === 0 && !propose;

  return (
    <Message className="max-w-full gap-3" from="assistant">
      {steps.length > 0 ? <Steps steps={steps} /> : null}
      {textParts.length > 0 ? (
        <MessageContent className="text-base leading-7">
          {textParts.map((part, index) => (
            <MessageResponse animated isAnimating={streaming} key={index}>{part.text}</MessageResponse>
          ))}
        </MessageContent>
      ) : streaming ? (
        <ThinkingDot />
      ) : null}
      {propose && (propose.proposal || propose.brief) ? <ProposalCard compact={compact} id={message.id} output={propose} /> : null}
      {showAgents ? <AgentsCard agents={propose?.agents ?? lastSearch!.agents} /> : null}
      {showNoMatch ? <NoMatchCard /> : null}
      {!streaming && (text.length > 0 || last) ? (
        <div
          className={cn(
            "-ml-1.5 flex items-center gap-0.5 transition-opacity",
            last ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {text.length > 0 ? <CopyButton text={text} /> : null}
          {last ? (
            <Button
              aria-label="Retry"
              className="size-7 rounded-md text-muted-foreground hover:text-foreground"
              onClick={onRetry}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </Message>
  );
}

function UserTurn({ message }: { message: ConciergeUIMessage }) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
  return (
    <Message className="max-w-[85%] sm:max-w-[70%]" from="user">
      <MessageContent className="rounded-3xl rounded-br-lg bg-secondary px-5 py-3 text-base leading-7 whitespace-pre-wrap">{text}</MessageContent>
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
  placeholder = "Describe what you need",
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;

  useEffect(() => {
    const text = initialPrompt?.trim().slice(0, CONCIERGE_LIMITS.userChars);
    if (!text || sentInitial.current) return;
    sentInitial.current = true;
    void sendMessage({ text });
  }, [initialPrompt, sendMessage]);

  const submit = (text: string) => {
    const trimmed = text.trim().slice(0, CONCIERGE_LIMITS.userChars);
    if (!trimmed || busy) return;
    setDraft("");
    void sendMessage({ text: trimmed });
    textarea.current?.focus();
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
  const nearLimit = draft.length >= CONCIERGE_LIMITS.userChars - 200;
  // The examples type themselves into the empty box, one after another.
  const livePlaceholder = useTypewriter(STARTERS, empty && draft.length === 0 && !busy, placeholder);

  return (
    <section
      aria-label="Concierge"
      className={cn(
        "flex min-h-0 flex-col",
        compact ? "marketplace-surface h-[28rem] overflow-hidden rounded-2xl" : "h-full",
      )}
    >
      {/* Above the composer: the greeting while the chat is empty, the
          conversation afterwards. */}
      <div className="flex min-h-0 flex-1 flex-col justify-end">
        {empty ? (
          <div className={cn(COLUMN, "pb-6 text-center", compact ? "pb-4" : "pb-6")}>
            <h2 className={cn("font-semibold tracking-tight text-balance", compact ? "text-xl" : "text-3xl sm:text-4xl")}>
              What do you need done?
            </h2>
          </div>
        ) : (
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className={cn(COLUMN, "gap-7 py-6", compact && "gap-5 py-4")}>
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <UserTurn key={message.id} message={message} />
                ) : (
                  <AssistantTurn
                    compact={compact}
                    key={message.id}
                    last={index === lastIndex}
                    message={message}
                    onRetry={() => void regenerate()}
                    streaming={busy && index === lastIndex}
                  />
                ),
              )}
              {status === "submitted" && messages[lastIndex]?.role === "user" ? (
                <Message className="max-w-full" from="assistant">
                  <ThinkingDot />
                </Message>
              ) : null}
              {error ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-amber-300" role="alert">
                  <span>{describeConciergeError(error)}</span>
                  <Button className="h-7 rounded-full border-amber-300/40 px-3 text-amber-200 hover:text-amber-100" onClick={() => void regenerate()} size="sm" type="button" variant="outline">
                    Try again
                  </Button>
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton className="bottom-3" />
          </Conversation>
        )}
      </div>

      <form aria-label="Ask the concierge" className={cn(COLUMN, "shrink-0", compact && "px-4")} onSubmit={onSubmit}>
        <div
          className={cn(
            "flex flex-col gap-2 rounded-[28px] border border-border bg-secondary/70 px-4 pt-3.5 pb-2.5 shadow-lg shadow-black/25",
            "transition-[border-color,box-shadow,background-color] duration-200",
            "focus-within:border-foreground/20 focus-within:bg-secondary focus-within:shadow-xl focus-within:shadow-black/30",
          )}
        >
          <Textarea
            aria-label="Your request"
            autoFocus={!compact}
            className={cn(
              "field-sizing-content min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-base shadow-none",
              "placeholder:text-muted-foreground/80 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent",
              compact ? "max-h-32" : "max-h-52",
            )}
            maxLength={CONCIERGE_LIMITS.userChars}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={livePlaceholder}
            ref={textarea}
            rows={1}
            value={draft}
          />
          <div className="flex items-center justify-between gap-3">
            <span aria-live="polite" className={cn("text-xs tabular-nums text-muted-foreground", !nearLimit && "invisible")}>
              {draft.length}/{CONCIERGE_LIMITS.userChars}
            </span>
            {busy ? (
              <Button aria-label="Stop" className="size-9 rounded-full bg-foreground text-background hover:bg-foreground/90" onClick={() => void stop()} size="icon" type="button">
                <SquareIcon aria-hidden="true" className="size-3 fill-current" />
              </Button>
            ) : (
              <Button aria-label="Send" className="size-9 rounded-full disabled:opacity-30" disabled={draft.trim().length === 0} size="icon" type="submit">
                <ArrowUpIcon aria-hidden="true" className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </form>

      {/* Below the composer. While the chat is empty this block shares the
          free space with the greeting, so the composer sits mid-screen; on
          the first message it gives that space up and the composer glides
          to the bottom, the way a chat app does. */}
      <div
        className={cn(COLUMN, "flex flex-col items-center gap-4 pt-3 transition-[flex-grow] duration-500 ease-out", compact ? "pb-3" : "pb-4")}
        style={{ flexBasis: 0, flexGrow: empty ? 1 : 0 }}
      >
        {empty ? (
          <div aria-label="Examples" className="flex flex-wrap justify-center gap-2" role="group">
            {STARTERS.map((starter) => (
              <Suggestion
                className="h-auto border-border bg-transparent px-3.5 py-1.5 text-[13px] font-normal whitespace-normal text-muted-foreground hover:bg-secondary hover:text-foreground"
                key={starter}
                onClick={submit}
                suggestion={starter}
              />
            ))}
          </div>
        ) : null}
        <p className="text-center text-xs text-muted-foreground">Drafts only. You review every field before a quote is requested.</p>
      </div>
    </section>
  );
}
