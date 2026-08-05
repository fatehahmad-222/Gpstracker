"use client";

import { motion } from "framer-motion";
import { Activity, KanbanSquare, UserCheck, Users } from "lucide-react";
import { isOnline } from "@/lib/utils";
import { OFFLINE_AFTER_MS } from "@/lib/constants";

export default function StatsBar({ profiles, positions, tasks, now, loading }) {
  const online = profiles.filter((p) => isOnline(positions[p.id]?.recorded_at, now, OFFLINE_AFTER_MS)).length;
  const offline = profiles.length - online;
  const activeTasks = tasks.length;

  const stats = [
    { label: "Employees", value: profiles.length, icon: Users, tint: "text-info" },
    { label: "Online now", value: online, icon: Activity, tint: "text-accent" },
    { label: "Offline", value: offline, icon: UserCheck, tint: "text-ink-dim" },
    { label: "Active tasks", value: activeTasks, icon: KanbanSquare, tint: "text-warning" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="rounded-card border border-line bg-surface p-4"
        >
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-dim">
            <stat.icon size={14} className={stat.tint} />
            {stat.label}
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-ink">
            {loading ? "–" : stat.value}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
