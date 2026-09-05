"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { BNB_ASCII_MARK } from "./bnb-ascii-mark";

const REVEAL_MS = 1_500;
const FRAME_MS = 1_000 / 24;
const NOISE = ".:-=+*#";
// After the reveal the mark keeps living: every few seconds a ripple starts
// at a random glyph and runs outward, scrambling the ring it passes through
// before each glyph settles again; between ripples single glyphs sparkle.
const RIPPLE_GAP_MS: readonly [number, number] = [1_200, 3_600];
const RIPPLE_SPEED = 0.028; // cells per millisecond
const RIPPLE_BAND = 2.6;    // ring thickness in cells
const RIPPLE_RADIUS_MAX = 26;
const SPARKLE_PER_FRAME = 0.35;
const SPARKLE_MS = 90;

interface Ripple { row: number; column: number; startedAt: number }
interface Sparkle { row: number; column: number; until: number }

// The server renders the finished mark, so the page never shows a
// placeholder. On the client the same glyphs resolve once out of noise from
// the centre outward, written to the row text nodes directly (React renders
// this component exactly once). The mark then keeps a slow life of its own
// with random ripples and sparkles. A pointer over the field lights the
// glyphs near it through CSS variables.
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

    const solidCells: Array<[number, number]> = [];
    lines.forEach((line, row) => Array.from(line).forEach((character, column) => {
      if (character !== " ") solidCells.push([row, column]);
    }));
    const randomCell = () => solidCells[Math.floor(Math.random() * solidCells.length)] ?? [0, 0];
    const noise = () => NOISE[Math.floor(Math.random() * NOISE.length)]!;

    let cancelled = false;
    let lastFrame = 0;
    let frame = 0;
    let visible = true;
    let ripples: Ripple[] = [];
    let sparkles: Sparkle[] = [];
    const started = performance.now();
    let nextRippleAt = started + REVEAL_MS + 600;
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; })
      : null;
    observer?.observe(pre);

    const write = (next: readonly string[]) => {
      for (let row = 0; row < rows.length; row += 1) {
        const text = next[row] ?? "";
        if (rows[row]!.textContent !== text) rows[row]!.textContent = text;
      }
    };

    const revealFrame = (elapsed: number) => lines.map((line, row) => Array.from(line, (character, column) => {
      if (character === " " || elapsed >= resolveAt[row]![column]!) return character;
      return noise();
    }).join(""));

    const liveFrame = (now: number) => {
      if (now >= nextRippleAt) {
        const [row, column] = randomCell();
        ripples.push({ row, column, startedAt: now });
        nextRippleAt = now + RIPPLE_GAP_MS[0] + Math.random() * (RIPPLE_GAP_MS[1] - RIPPLE_GAP_MS[0]);
      }
      ripples = ripples.filter((ripple) => (now - ripple.startedAt) * RIPPLE_SPEED < RIPPLE_RADIUS_MAX + RIPPLE_BAND);
      if (Math.random() < SPARKLE_PER_FRAME) {
        const [row, column] = randomCell();
        sparkles.push({ row, column, until: now + SPARKLE_MS });
      }
      sparkles = sparkles.filter((sparkle) => sparkle.until > now);
      if (ripples.length === 0 && sparkles.length === 0) return lines;

      return lines.map((line, row) => Array.from(line, (character, column) => {
        if (character === " ") return character;
        for (const ripple of ripples) {
          const front = (now - ripple.startedAt) * RIPPLE_SPEED;
          const distance = Math.hypot(row - ripple.row, (column - ripple.column) * 0.65);
          if (distance <= front && distance > front - RIPPLE_BAND) return noise();
        }
        for (const sparkle of sparkles) {
          if (sparkle.row === row && sparkle.column === column) return noise();
        }
        return character;
      }).join(""));
    };

    const tick = (now: number) => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      const elapsed = now - started;
      if (elapsed < REVEAL_MS) {
        write(revealFrame(elapsed));
        return;
      }
      if (!visible || document.hidden) return;
      write(liveFrame(now));
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
      observer?.disconnect();
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
