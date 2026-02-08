"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight polling hook. Calls `fn` on mount and every `intervalMs`.
 * Auto-pauses when the tab is hidden, resumes when visible.
 */
export function usePolling(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    // Initial fetch
    fnRef.current();

    const id = setInterval(() => {
      if (!document.hidden) {
        fnRef.current();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}
