"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polling that pauses when the tab is hidden.
 *
 * Spec 7 requires "Live pills with polling that pauses when the tab is
 * hidden". We listen to visibilitychange and, while hidden, stop the interval
 * and refetch immediately on return so the view is never stale on focus.
 */
export function usePolling(fn, { intervalMs = 30000, enabled = true, refetchOnFocus = true } = {}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const savedFn = useRef(fn);

  useEffect(() => {
    savedFn.current = fn;
  }, [fn]);

  const run = useCallback(async ({ silent = true } = {}) => {
    if (!silent) setIsRefreshing(true);
    try {
      await savedFn.current?.();
      setLastUpdated(Date.now());
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;

    let timer = null;
    let cancelled = false;

    const start = () => {
      stop();
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stop();
      } else {
        if (refetchOnFocus) run();
        start();
      }
    };

    start();
    document?.addEventListener?.("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stop();
      document?.removeEventListener?.("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, run, refetchOnFocus]);

  return { isRefreshing, lastUpdated, refresh: () => run({ silent: false }) };
}

/**
 * Company-timezone "today" that stays stable across a server/client boundary.
 *
 * `new Date()` on the server and in the browser can differ by a day, which
 * would make the seeded date in a server-rendered page disagree with the
 * client's filters. We resolve it once on the server and pass it down.
 */
export function useToday(initialToday) {
  const [today] = useState(() => initialToday || new Date().toISOString().slice(0, 10));
  return today;
}