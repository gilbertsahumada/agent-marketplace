"use client";

import { useEffect, useState } from "react";

const DURATION_MS = 1_400;
const FORMAT = new Intl.NumberFormat("en");

// Server-renders the final formatted value (no hydration disagreement), then
// counts up to it once on the client unless motion is reduced.
export function CountUp({ value, formatted }: { value: number; formatted: string }) {
  const [text, setText] = useState(formatted);

  useEffect(() => {
    setText(formatted);
    if (value <= 0 || typeof window.requestAnimationFrame !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      setText(progress < 1 ? FORMAT.format(Math.round(value * eased)) : formatted);
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [value, formatted]);

  return <>{text}</>;
}
