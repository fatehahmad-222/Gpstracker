import { describe, it, expect } from "vitest";

import {
  APP_TASK_FILTERS,
  canEmployeeTransition,
  completionSourceFor,
  employeeNextStatuses,
  filterEmployeeTasks,
  normaliseTaskFilter,
} from "@/lib/monitor/appTasks";

describe("normaliseTaskFilter", () => {
  it("accepts known filters and falls back to all", () => {
    for (const filter of APP_TASK_FILTERS) {
      expect(normaliseTaskFilter(filter)).toBe(filter);
    }
    expect(normaliseTaskFilter("cancelled-by-admin")).toBe("all");
    expect(normaliseTaskFilter(null)).toBe("all");
  });
});

describe("employeeNextStatuses", () => {
  it("lets an employee work a task forward but never cancel it", () => {
    expect(employeeNextStatuses("pending")).toEqual(["in_progress", "completed"]);
    expect(employeeNextStatuses("in_progress")).toEqual(["completed"]);
    expect(employeeNextStatuses("completed")).toEqual([]);
    expect(employeeNextStatuses("cancelled")).toEqual([]);
  });

  it("rejects every illegal employee transition", () => {
    expect(canEmployeeTransition("pending", "in_progress")).toBe(true);
    expect(canEmployeeTransition("pending", "completed")).toBe(true);
    expect(canEmployeeTransition("in_progress", "completed")).toBe(true);

    expect(canEmployeeTransition("pending", "cancelled")).toBe(false);
    expect(canEmployeeTransition("in_progress", "pending")).toBe(false);
    expect(canEmployeeTransition("completed", "in_progress")).toBe(false);
    expect(canEmployeeTransition("cancelled", "pending")).toBe(false);
  });
});

describe("completionSourceFor", () => {
  it("never lets the app claim a geofence completion", () => {
    expect(completionSourceFor("completed")).toBe("manual");
    expect(completionSourceFor("in_progress")).toBeNull();
    expect(completionSourceFor("cancelled")).toBeNull();
  });
});

describe("filterEmployeeTasks", () => {
  const rows = [
    { id: "1", status: "completed", due_at: null, created_at: "2026-01-01" },
    { id: "2", status: "pending", due_at: "2026-01-05", created_at: "2026-01-02" },
    { id: "3", status: "in_progress", due_at: "2026-01-03", created_at: "2026-01-03" },
    { id: "4", status: "cancelled", due_at: null, created_at: "2026-01-04" },
  ];

  it("puts open work first and sorted by due date", () => {
    expect(filterEmployeeTasks(rows, "all").map((row) => row.id)).toEqual([
      "3",
      "2",
      "4",
      "1",
    ]);
  });

  it("supports open and exact-status filters", () => {
    expect(filterEmployeeTasks(rows, "open").map((row) => row.id)).toEqual(["3", "2"]);
    expect(filterEmployeeTasks(rows, "completed").map((row) => row.id)).toEqual(["1"]);
    expect(filterEmployeeTasks(rows, "cancelled").map((row) => row.id)).toEqual(["4"]);
  });
});
