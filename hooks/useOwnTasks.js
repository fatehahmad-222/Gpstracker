"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/**
 * Loads the signed-in employee's tasks and keeps them live via Realtime
 * (new assignments, status changes, geofence completions all stream in).
 */
export function useOwnTasks(userId) {
  const [tasks, setTasks] = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return;

    let mounted = true;

    supabase
      .from("tasks")
      .select("*")
      .eq("employee_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setError(error.message);
        else setTasks(data ?? []);
      });

    const channel = supabase
      .channel(`my-tasks:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: { employee_id: userId },
        },
        (payload) => {
          if (!mounted) return;
          setTasks((prev) => {
            const list = prev ?? [];
            if (payload.eventType === "DELETE") {
              return list.filter((t) => t.id !== payload.old.id);
            }
            const others = list.filter((t) => t.id !== (payload.new?.id ?? payload.old?.id));
            return [payload.new, ...others];
          });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Task realtime channel error", status);
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return { tasks, error };
}
