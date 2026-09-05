"use client";

import { useEffect, useRef } from "react";

// Slow ASCII cloud field behind the hero: value-noise fBm sampled on a
// character grid and drawn to a canvas, so a few thousand glyphs per frame
// cost nothing in the DOM. Glyph density follows the noise, colour is the
// signal yellow at low alpha, and the CSS mask fades it toward the text.
// One frame is drawn and the loop stops when the viewer prefers reduced
// motion; the loop also pauses off-screen and in hidden tabs.

const GLYPHS = " ·:+*";
const CELL = 14;
const FRAME_MS = 1_000 / 18;
const THRESHOLD = 0.4;

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
  const wind = time * 0.11;
  const swell = time * 0.045;
  return (
    0.5 * valueNoise(x - wind, y + swell * 0.35)
    + 0.25 * valueNoise(x * 2.1 + 5.2 - wind * 1.4, y * 2.1 + 1.3 - swell * 0.5)
    + 0.125 * valueNoise(x * 4.3 + 9.1 - wind * 0.7, y * 4.3 + 7.7 + swell)
  ) / 0.875;
}

export function glyphFor(density: number): string {
  if (density < THRESHOLD) return " ";
  const index = Math.min(GLYPHS.length - 1, 1 + Math.floor(((density - THRESHOLD) / (1 - THRESHOLD)) * (GLYPHS.length - 1)));
  return GLYPHS[index]!;
}

export function AsciiClouds({ className = "hero-clouds" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof window.requestAnimationFrame !== "function") return;
    const context = canvas.getContext("2d");
    if (context === null) return;
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
      context.font = `600 ${CELL * 0.82}px ${getComputedStyle(canvas).fontFamily || "monospace"}`;
      context.textBaseline = "top";
    };
    resize();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const columns = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const density = cloudDensity(column * 0.09, row * 0.14, time);
          const glyph = glyphFor(density);
          if (glyph === " ") continue;
          context.fillStyle = `rgb(255 233 0 / ${(0.1 + (density - THRESHOLD) * 0.95).toFixed(3)})`;
          context.fillText(glyph, column * CELL, row * CELL);
        }
      }
    };

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
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  return <canvas aria-hidden="true" className={className} ref={canvasRef} />;
}
