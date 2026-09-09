// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LandingMotion } from "../components/marketplace/landing-motion";

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

function setup(reduced = false) {
  let callback: IntersectionObserverCallback;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  const preference = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => preference);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn(() => ({ cancel: vi.fn(), onfinish: null })) });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
  const view = render(<main className="home-landing"><LandingMotion /><section className="home-hero"><div>Hero</div></section><section><div><h2>Services</h2><ul><li><p>Card</p></li></ul></div></section></main>);
  return { ...view, observe, unobserve, disconnect, preference, enter: (target: Element) => callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver) };
}

it("reveals sections once and cancels active motion on cleanup", () => {
  const page = setup();
  expect(page.observe).toHaveBeenCalledTimes(2);
  const section = page.observe.mock.calls[0]![0] as HTMLElement;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, onfinish: null }));
  Object.defineProperty(section, "animate", { value: animate });
  page.enter(section);
  expect(animate).toHaveBeenCalledOnce();
  expect(page.unobserve).toHaveBeenCalledWith(section);
  page.unmount();
  expect(cancel).toHaveBeenCalledOnce();
  expect(page.disconnect).toHaveBeenCalled();
});

it("does not observe or hide content with reduced motion", () => {
  const page = setup(true);
  expect(page.observe).not.toHaveBeenCalled();
  expect(page.container.textContent).toBe("HeroServicesCard");
});

it("keeps content available when browser animation APIs are missing", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const page = render(<main className="home-landing"><LandingMotion /><p>Services</p></main>);
  expect(page.container.textContent).toBe("Services");
});
