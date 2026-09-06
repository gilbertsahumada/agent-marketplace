"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_STAGE_AGENT, RESTING_ELAPSED, STEP_TITLES, stageFrame, type StageAgent, type StageFrame } from "./hiring-stage-model";

const FRAME_MS = 1_000 / 15;

export interface HiringStageAgent extends StageAgent {
  href: string;
  quoteCapable: boolean;
}

// The server renders the finished scene (brief written, hire done). On the
// client the loop starts from the top: the brief types itself, then the
// timeline runs. State updates are throttled to 15 fps and pause when the
// stage is off-screen or the tab is hidden; reduced motion keeps the
// finished scene.
export function HiringStage({ agent = null }: { agent?: HiringStageAgent | null }) {
  const stageAgent = agent ?? DEFAULT_STAGE_AGENT;
  const [frame, setFrame] = useState<StageFrame>(() => stageFrame(RESTING_ELAPSED, stageAgent, () => 0));

  useEffect(() => {
    if (typeof window.requestAnimationFrame !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.getElementById("hiring-stage");
    let cancelled = false;
    let visible = true;
    let last = 0;
    let handle = 0;
    const started = performance.now();
    const observer = typeof IntersectionObserver === "function" && root
      ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; })
      : null;
    if (root) observer?.observe(root);
    const tick = (now: number) => {
      if (cancelled) return;
      handle = window.requestAnimationFrame(tick);
      if (!visible || document.hidden || now - last < FRAME_MS) return;
      last = now;
      setFrame(stageFrame(now - started, stageAgent));
    };
    handle = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
      observer?.disconnect();
    };
  }, [stageAgent]);

  return (
    <div className="hiring-stage market-terminal" id="hiring-stage">
      <div className="market-terminal__bar">
        <span className="flex items-center gap-2">
          <span className="market-terminal__lights" aria-hidden="true"><i /><i /><i /></span>
          <strong>hire</strong>
          <span className="text-muted-foreground">· one brief, one escrow, one receipt</span>
        </span>
        <span className="hiring-stage__phase">{frame.briefDone ? "running the hire" : "writing the brief"}</span>
      </div>

      <div className="hiring-stage__body">
        <section aria-label="Your brief" className="hiring-stage__brief">
          <p className="hiring-stage__eyebrow">Your brief · plain words</p>
          <dl>
            <div><dt>What I need</dt><dd>{frame.brief.objective}</dd></div>
            <div><dt>What I get back</dt><dd>{frame.brief.deliverable}</dd></div>
            <div><dt>How I will judge it</dt><dd>{frame.brief.acceptance}</dd></div>
          </dl>
          <p className="hiring-stage__meta">{frame.brief.meta}</p>
        </section>

        <ol aria-label="What happens for you" className="hiring-stage__timeline" style={{ "--rail": frame.rail } as React.CSSProperties}>
          {frame.steps.map((step, index) => (
            <li data-state={step.state} key={STEP_TITLES[index]}>
              <span className="hiring-stage__node" aria-hidden="true" />
              <h3>{step.title}</h3>
              <pre aria-hidden="true">{step.lines[0]}{"\n"}{step.lines[1]}</pre>
            </li>
          ))}
        </ol>
      </div>

      <div className="hiring-stage__footer">
        <p>Today you brief one verified agent at a time. Open applications, where agents come to your brief, are next.</p>
        <span className="hiring-stage__actions">
          {agent ? (
            <Button asChild className="h-11 rounded-md px-5 text-sm font-semibold" size="lg">
              <Link href={agent.href}>{agent.quoteCapable ? `Get a quote from ${agent.name}` : `See ${agent.name}`} <ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
            </Button>
          ) : null}
          <Button asChild className="h-11 rounded-md border-border bg-card px-5 text-sm" size="lg" variant="outline">
            <Link href="/agents?view=marketplace">Browse verified agents</Link>
          </Button>
        </span>
      </div>
    </div>
  );
}
