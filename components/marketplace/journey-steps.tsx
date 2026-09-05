"use client";

import { useEffect, useRef, useState } from "react";
import { JOURNEY_SCENES } from "./journey-scenes";

const STEP_MS = 3_000;
const FRAME_MS = 1_000 / 12;

// The four journey steps with a small ASCII scene each. The server renders
// every scene at rest; on the client the steps take turns: the active one
// replays its scene from the start while the others hold their resting
// frame. Frames go straight to the row text nodes.
export function JourneySteps() {
  const preRefs = useRef<Array<HTMLPreElement | null>>([]);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window.requestAnimationFrame !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pres = preRefs.current;
    let cancelled = false;
    let visible = true;
    let lastFrame = 0;
    let frame = 0;
    let shown = -1;
    const started = performance.now();
    const first = pres.find((pre) => pre !== null);
    const observer = typeof IntersectionObserver === "function" && first
      ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; })
      : null;
    if (first) observer?.observe(first);

    const write = (pre: HTMLPreElement | null, lines: readonly string[]) => {
      if (pre === null) return;
      const rows = pre.children;
      for (let row = 0; row < rows.length; row += 1) {
        const text = lines[row] ?? "";
        if (rows[row]!.textContent !== text) rows[row]!.textContent = text;
      }
    };

    const tick = (now: number) => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(tick);
      if (!visible || document.hidden || now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      const elapsed = now - started;
      const current = Math.floor(elapsed / STEP_MS) % JOURNEY_SCENES.length;
      const progress = (elapsed % STEP_MS) / STEP_MS;
      if (current !== shown) {
        shown = current;
        setActive(current);
        JOURNEY_SCENES.forEach((scene, index) => { if (index !== current) write(pres[index] ?? null, scene.frame(1)); });
      }
      write(pres[current] ?? null, JOURNEY_SCENES[current]!.frame(progress));
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return (
    <ol className="market-steps grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {JOURNEY_SCENES.map(({ step, detail, frame }, index) => (
        <li className="relative pt-7" data-active={active === index ? "true" : undefined} key={step}>
          <span className="market-step-dot" aria-hidden="true" />
          <pre className="market-scene" aria-hidden="true" ref={(node) => { preRefs.current[index] = node; }}>
            {frame(1).map((line, row) => <span key={row}>{line}</span>)}
          </pre>
          <span className="font-stat text-[10px] text-signal">0{index + 1}</span>
          <h3 className="mt-3 text-xl font-semibold text-foreground">{step}</h3>
          <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{detail}</p>
        </li>
      ))}
    </ol>
  );
}
