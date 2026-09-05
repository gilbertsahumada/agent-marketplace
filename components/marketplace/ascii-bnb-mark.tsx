"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { BNB_ASCII_MARK } from "./bnb-ascii-mark";

const REVEAL_MS = 1_500;
const FRAME_MS = 1_000 / 30;
const NOISE = ".:-=+*#";

// The server renders the finished mark, so the page never shows a
// placeholder. On the client the same glyphs resolve once out of noise from
// the centre outward, written to the row text nodes directly (React renders
// this component exactly once), then the mark holds still. A pointer over
// the field lights the glyphs near it through CSS variables.
export function AsciiBnbMark({ lines = BNB_ASCII_MARK, animate = true }: { lines?: readonly string[]; animate?: boolean }) {
  const preRef = useRef<HTMLPreElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pre = preRef.current;
    const field = fieldRef.current;
    if (!animate || pre === null || field === null) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof window.requestAnimationFrame !== "function") return;

    const rows = Array.from(pre.children) as HTMLElement[];
    const columns = Math.max(...lines.map((line) => line.length), 1);
    const centreRow = (lines.length - 1) / 2;
    const centreColumn = (columns - 1) / 2;
    const radius = Math.hypot(centreRow, centreColumn * 0.65) || 1;
    // Each glyph resolves at a time set by its distance from the centre plus
    // a little jitter, so the shape grows outward instead of wiping.
    const resolveAt = lines.map((line, row) => Array.from(line, (character, column) => {
      if (character === " ") return 0;
      const distance = Math.hypot(row - centreRow, (column - centreColumn) * 0.65) / radius;
      return REVEAL_MS * (0.12 + 0.78 * distance + Math.random() * 0.1);
    }));

    let cancelled = false;
    let lastFrame = 0;
    let frame = 0;
    const started = performance.now();

    const write = (next: readonly string[]) => {
      for (let row = 0; row < rows.length; row += 1) {
        const text = next[row] ?? "";
        if (rows[row]!.textContent !== text) rows[row]!.textContent = text;
      }
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - started;
      if (elapsed >= REVEAL_MS) {
        write(lines);
        return;
      }
      frame = window.requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      write(lines.map((line, row) => Array.from(line, (character, column) => {
        if (character === " " || elapsed >= resolveAt[row]![column]!) return character;
        return NOISE[Math.floor(Math.random() * NOISE.length)]!;
      }).join("")));
    };
    frame = window.requestAnimationFrame(tick);

    const onMove = (event: PointerEvent) => {
      const box = pre.getBoundingClientRect();
      field.style.setProperty("--mark-x", `${event.clientX - box.left}px`);
      field.style.setProperty("--mark-y", `${event.clientY - box.top}px`);
    };
    const onLeave = () => {
      field.style.setProperty("--mark-x", "-999px");
      field.style.setProperty("--mark-y", "-999px");
    };
    field.addEventListener("pointermove", onMove);
    field.addEventListener("pointerleave", onLeave);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      field.removeEventListener("pointermove", onMove);
      field.removeEventListener("pointerleave", onLeave);
      write(lines);
    };
  }, [animate, lines]);

  return (
    <div className="market-ascii-logo-field" ref={fieldRef} style={{ "--mark-x": "-999px", "--mark-y": "-999px" } as CSSProperties}>
      <pre className="market-ascii-logo" aria-label="BNB Chain symbol rendered as ASCII" ref={preRef} role="img">
        {lines.map((line, row) => <span className="market-ascii-line" key={row}>{line}</span>)}
      </pre>
    </div>
  );
}
