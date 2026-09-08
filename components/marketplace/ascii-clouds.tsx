"use client";

import { useEffect, useRef } from "react";

// Slow ASCII cloud field behind the hero: value-noise fBm sampled on a
// character grid and drawn to a canvas, so a few thousand glyphs per frame
// cost nothing in the DOM. Glyph density follows the noise, colour is the
// signal yellow at low alpha, and the CSS mask fades it toward the text.
// Cells flip between two glyph ramps on their own rhythm, so characters
// change as well as drift, and a soft halo follows the pointer and brightens
// the glyphs it touches. One frame is drawn and the loop stops when the
// viewer prefers reduced motion (the halo still redraws on pointer moves);
// the loop also pauses off-screen and in hidden tabs.

export const GLYPHS = " ·:∴≈∿◌◍░▒";
export const ALT_GLYPHS = " ˙∙∵~≋○●▚▞";
const CELL = 14;
const FRAME_MS = 1_000 / 24;
const THRESHOLD = 0.4;
export const GLOW_RADIUS = 150;

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43_758.5453;
  return n - Math.floor(n);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Three octaves; the sum stays within [0, 0.875].
export function cloudDensity(x: number, y: number, time: number): number {
  // A steady wind from the left plus a slow swell, so the field both drifts
  // and reshapes instead of sliding as one sheet.
  const wind = time * 0.3;
  const swell = time * 0.13;
  return (
    0.5 * valueNoise(x - wind, y + swell * 0.35)
    + 0.25 * valueNoise(x * 2.1 + 5.2 - wind * 1.6, y * 2.1 + 1.3 - swell * 0.6)
    + 0.125 * valueNoise(x * 4.3 + 9.1 - wind * 2.2, y * 4.3 + 7.7 + swell * 1.4)
  ) / 0.875;
}

// Fast per-cell shimmer layered over the slow field, so glyphs twinkle at
// the cloud edges instead of only sliding.
export function shimmer(column: number, row: number, time: number): number {
  return 0.07 * Math.sin(time * 4.2 + hash(column, row) * Math.PI * 2);
}

export function glyphFor(density: number, ramp: string = GLYPHS): string {
  if (density < THRESHOLD) return " ";
  const index = Math.min(ramp.length - 1, 1 + Math.floor(((density - THRESHOLD) / (1 - THRESHOLD)) * (ramp.length - 1)));
  return [...ramp][index]!;
}

// Each cell swaps to the alternate ramp for a short while on its own phase,
// so at any moment roughly a quarter of the visible glyphs are "mutated".
export function mutates(column: number, row: number, time: number): boolean {
  return Math.sin(time * 0.9 + hash(column * 3.1, row * 1.7) * Math.PI * 2) > 0.72;
}

export function glyphAt(density: number, column: number, row: number, time: number): string {
  return glyphFor(density, mutates(column, row, time) ? ALT_GLYPHS : GLYPHS);
}

// 1 under the pointer, 0 at the radius, eased so the halo has a soft edge.
export function glowAt(dx: number, dy: number, radius: number = GLOW_RADIUS): number {
  const linear = Math.max(0, 1 - Math.hypot(dx, dy) / radius);
  return linear * linear;
}

export interface AsciiCloudsProps {
  className?: string;
  /** Glyph colour as an "r g b" triple. */
  color?: string;
  /** Colour of glyphs inside the pointer halo. */
  glowColor?: string;
  /** Alpha ramp slope; lower is fainter. */
  alpha?: number;
}

export function AsciiClouds({
  className = "hero-clouds",
  color = "255 233 0",
  glowColor = "255 251 209",
  alpha = 0.95,
}: AsciiCloudsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof window.requestAnimationFrame !== "function") return;
    const context = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (context === null || context === undefined) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let scale = 1;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      scale = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, Math.floor(box.width));
      height = Math.max(1, Math.floor(box.height));
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.font = `600 ${CELL * 0.86}px ${getComputedStyle(canvas).fontFamily || "monospace"}`;
      context.textBaseline = "top";
    };
    resize();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);

    // The canvas ignores pointer events so the page underneath stays
    // interactive; the halo tracks the pointer over the parent instead.
    const host = canvas.parentElement ?? canvas;
    let pointerX = Number.NEGATIVE_INFINITY;
    let pointerY = Number.NEGATIVE_INFINITY;
    let lastTime = 0;

    const draw = (time: number) => {
      lastTime = time;
      context.clearRect(0, 0, width, height);
      const columns = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          let density = cloudDensity(column * 0.09, row * 0.14, time) + shimmer(column, row, time);
          const glow = glowAt(column * CELL + CELL / 2 - pointerX, row * CELL + CELL / 2 - pointerY);
          if (density < THRESHOLD && glow < 0.05) continue;
          // Hidden cells surface under the pointer, then fade back out.
          if (density < THRESHOLD) density = THRESHOLD + glow * 0.5;
          const glyph = glyphAt(density, column, row, time);
          if (glyph === " ") continue;
          const level = Math.min(1, 0.1 + (density - THRESHOLD) * alpha + glow * 0.9);
          context.fillStyle = `rgb(${glow > 0.02 ? glowColor : color} / ${level.toFixed(3)})`;
          context.fillText(glyph, column * CELL, row * CELL);
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointerX = event.clientX - box.left;
      pointerY = event.clientY - box.top;
      if (reduced) draw(lastTime);
    };
    const onPointerLeave = () => {
      pointerX = Number.NEGATIVE_INFINITY;
      pointerY = Number.NEGATIVE_INFINITY;
      if (reduced) draw(lastTime);
    };
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave);

    let visible = true;
    let cancelled = false;
    let lastFrame = 0;
    let frame = 0;
    const started = performance.now();
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; })
      : null;
    observer?.observe(canvas);

    const tick = (now: number) => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(tick);
      if (!visible || document.hidden || now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      draw((now - started) / 1_000);
    };

    if (reduced) {
      draw(0);
    } else {
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [alpha, color, glowColor]);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}
