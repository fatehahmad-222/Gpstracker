"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/** All tasks for the admin boards, live via Realtime, plus a profiles map. */
export function useAdminTasks() {
  const [tasks, setTasks] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setError(error.message);
        else setTasks(data ?? []);
      });

    supabase
      .from("profiles")
      .select("id, full_name, role, phone, avatar_url")
      .then(({ data }) => {
        if (!mounted) return;
        const map = {};
        (data ?? []).forEach((p) => {
          map[p.id] = p;
        });
        setProfiles(map);
      });

    const channel = supabase
      .channel("admin-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        (payload) => {
          if (!mounted) return;
          setTasks((prev) => {
            const list = prev ?? [];
            if (payload.eventType === "DELETE") {
              return list.filter((t) => t.id !== payload.old.id);
            }
            const id = payload.new?.id ?? payload.old?.id;
            return [payload.new, ...list.filter((t) => t.id !== id)];
          });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Admin tasks realtime channel error", status);
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { tasks, profiles, error };
}
