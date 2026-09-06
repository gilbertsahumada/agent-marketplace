import { useEffect, useState } from "react";

export interface TypewriterTiming {
  typeMs: number;
  deleteMs: number;
  holdMs: number;
  restMs: number;
}

export const TYPEWRITER_TIMING: TypewriterTiming = { typeMs: 38, deleteMs: 18, holdMs: 1_800, restMs: 500 };

/**
 * Cycles through `phrases` the way a person would type them into the box:
 * letter by letter, a pause to read, then deleted and on to the next. Runs
 * only while `active`; idle (or reduced motion) shows `fallback` at rest.
 */
export function useTypewriter(phrases: readonly string[], active: boolean, fallback: string, timing: TypewriterTiming = TYPEWRITER_TIMING): string {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    if (!active || phrases.length === 0) {
      setText(fallback);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(fallback);
      return;
    }
    let index = 0;
    let length = 0;
    let deleting = false;
    let timer = 0;
    const step = () => {
      const phrase = phrases[index]!;
      let delay: number;
      if (!deleting) {
        length += 1;
        delay = length >= phrase.length ? timing.holdMs : timing.typeMs;
        if (length >= phrase.length) deleting = true;
      } else if (length > 0) {
        length -= 1;
        delay = length === 0 ? timing.restMs : timing.deleteMs;
      } else {
        deleting = false;
        index = (index + 1) % phrases.length;
        delay = timing.typeMs;
      }
      setText(phrase.slice(0, length));
      timer = window.setTimeout(step, delay);
    };
    timer = window.setTimeout(step, timing.restMs);
    return () => window.clearTimeout(timer);
  }, [active, fallback, phrases, timing]);

  return text;
}
