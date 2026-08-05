"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * Lightweight connection indicator. Uses its own channel so the indicator
 * keeps working even if a page's main subscription is mid-refetch.
 */
export function useRealtimeStatus() {
  const [status, setStatus] = useState("connecting");
  const statusRef = useRef("connecting");

  useEffect(() => {
    let retryTimer;
    let disposed = false;
    let channel;

    const apply = (next) => {
      statusRef.current = next;
      setStatus(next);
    };

    const connect = () => {
      if (disposed) return;
      apply("connecting");
      channel = supabase
        .channel("conn-indicator")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_locations" },
          () => {}
        )
        .subscribe((s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") {
            apply("live");
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
            apply("error");
            retryTimer = setTimeout(connect, 4000);
          } else if (s === "CLOSED") {
            apply("error");
            retryTimer = setTimeout(connect, 4000);
          }
        });
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
