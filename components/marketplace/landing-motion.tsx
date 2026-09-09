"use client";

import { useEffect } from "react";

// Enhance server-rendered content without hiding it or delaying interaction.
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector(".home-landing");
    if (!root || !window.matchMedia || !window.IntersectionObserver) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const pending = new Set<HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        entry.target.removeAttribute("data-reveal-pending");
        pending.delete(entry.target as HTMLElement);
        if (preference.matches || !(entry.target instanceof HTMLElement) || !entry.target.animate) continue;
        const animation = entry.target.animate(
          [{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 550, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    }, { threshold: 0.1 });
    if (!preference.matches) {
      const selector = "h2, p, li, [data-slot='button'], .home-cta, .marketplace-surface";
      root.querySelectorAll(":scope > section:not(.home-hero)").forEach((section) => {
        section.querySelectorAll<HTMLElement>(selector).forEach((element) => {
          // Animate a card as a unit, never its nested text at the same time.
          if (element.parentElement?.closest(selector) || !element.animate) return;
          if (element.getBoundingClientRect().top >= window.innerHeight) {
            element.setAttribute("data-reveal-pending", "");
            pending.add(element);
          }
          observer.observe(element);
        });
      });
    }
    const stop = () => {
      if (!preference.matches) return;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      pending.forEach((element) => element.removeAttribute("data-reveal-pending"));
      pending.clear();
    };
    preference.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      pending.forEach((element) => element.removeAttribute("data-reveal-pending"));
      preference.removeEventListener("change", stop);
    };
  }, []);
  return null;
}
