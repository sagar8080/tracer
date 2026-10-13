"use client";

import { useEffect, useRef, type ReactNode } from "react";
import s from "./motion.module.css";

// Enhancement only: server-rendered content is visible without JavaScript.
export function PageMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    const sync = () => {
      html.style.scrollBehavior = media.matches ? "auto" : "smooth";
    };
    sync();
    media.addEventListener("change", sync);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ isIntersecting, target }) => {
          if (!isIntersecting) return;
          target.setAttribute("data-visible", "true");
          observer.unobserve(target);
        });
      },
      { threshold: 0.12 },
    );
    root.current
      ?.querySelectorAll("[data-reveal]")
      .forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      html.style.scrollBehavior = previous;
    };
  }, []);
  return (
    <div ref={root} className={s.motion}>
      {children}
    </div>
  );
}
