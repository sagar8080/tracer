"use client";

import { useEffect, useRef, useState } from "react";

// Each example owns its playback. Hidden/offscreen examples do no timed work.
export function useScenePlayback(count: number, duration = 7000) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [requested, setRequested] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      setReduced(media.matches);
      if (media.matches) setRequested(false);
    };
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion();
    syncVisibility();
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  const playing = requested && visible && pageVisible && !reduced && !held;
  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      duration,
    );
    return () => window.clearInterval(timer);
  }, [playing, count, duration]);

  return {
    rootRef,
    index,
    playing,
    requested: requested && !reduced,
    reduced,
    setHeld,
    stop: () => setRequested(false),
    select: (next: number) => {
      setIndex(next);
      setRequested(false);
    },
    toggle: () => setRequested((value) => !value),
    duration,
  };
}
