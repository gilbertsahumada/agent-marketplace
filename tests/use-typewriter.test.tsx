// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypewriter } from "../components/marketplace/use-typewriter";

const phrases = ["ab", "cd"] as const;
const timing = { typeMs: 10, deleteMs: 5, holdMs: 100, restMs: 20 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTypewriter", () => {
  it("types a phrase letter by letter, holds it, deletes it and moves on", () => {
    const { result } = renderHook(() => useTypewriter(phrases, true, "Describe what you need", timing));
    expect(result.current).toBe("Describe what you need");

    act(() => vi.advanceTimersByTime(20));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(10));
    expect(result.current).toBe("ab");
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(5));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(20 + 10));
    expect(result.current).toBe("c");
  });

  it("rests on the fallback while inactive and when motion is reduced", () => {
    const { result, rerender } = renderHook(({ active }) => useTypewriter(phrases, active, "Describe what you need", timing), { initialProps: { active: false } });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe("Describe what you need");

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(25));
    expect(result.current).toBe("a");
    rerender({ active: false });
    expect(result.current).toBe("Describe what you need");

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    rerender({ active: true });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe("Describe what you need");
    vi.unstubAllGlobals();
  });
});
