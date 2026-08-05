"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * Live source of truth for the admin overview:
 * - all employee profiles
 * - latest position per employee (live_locations)
 * - open tasks (pending / in_progress)
 * Both live_locations and tasks stream in via Realtime with auto-reconnect.
 */
export function useLiveOverview() {
  const [profiles, setProfiles] = useState([]);
  const [positions, setPositions] = useState({});
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState("connecting");
  const [now, setNow] = useState(Date.now());
  const positionsRef = useRef({});

  useEffect(() => {
    let mounted = true;

    Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role, phone, avatar_url, created_at")
        .order("full_name"),
      supabase.from("live_locations").select("*"),
      supabase.from("tasks").select("*").in("status", ["pending", "in_progress"]),
    ]).then(([profilesRes, locsRes, tasksRes]) => {
      if (!mounted) return;
      setProfiles((profilesRes.data ?? []).filter((p) => p.role === "employee"));
      const map = {};
      (locsRes.data ?? []).forEach((row) => {
        map[row.employee_id] = row;
      });
      positionsRef.current = map;
      setPositions(map);
      setTasks(tasksRes.data ?? []);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let retryTimer;
    let disposed = false;
    let channel;

    const connect = () => {
      if (disposed) return;
      setConnection("connecting");

      channel = supabase
        .channel("overview-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_locations" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              setPositions((prev) => {
                const next = { ...prev };
                delete next[payload.old.employee_id];
                return next;
              });
            } else {
              const row = payload.new;
              positionsRef.current[row.employee_id] = row;
              setPositions({ ...positionsRef.current });
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          (payload) => {
            setTasks((prev) => {
              const list = prev ?? [];
              if (payload.eventType === "DELETE") {
                return list.filter((t) => t.id !== payload.old.id);
              }
              const id = payload.new?.id ?? payload.old?.id;
              const others = list.filter((t) => t.id !== id);
              const row = payload.new;
              if (row && (row.status === "pending" || row.status === "in_progress")) {
                return [row, ...others];
              }
              return others;
            });
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setConnection("live");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("error");
            retryTimer = setTimeout(connect, 3000);
          } else if (status === "CLOSED") {
            setConnection("error");
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

  // Re-render periodically so online/offline recency stays accurate.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  return { profiles, positions, tasks, loading, connection, now };
}
