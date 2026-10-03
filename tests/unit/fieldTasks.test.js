import { describe, it, expect } from "vitest";

import {
  validateTask,
  resolveAssignee,
  canTransition,
  nextStatuses,
  isOpen,
  matchesStatusFilter,
  sortTasks,
  TASK_STATUSES,
  TASK_STATUS_META,
  MAX_TITLE_LENGTH,
} from "@/lib/monitor/fieldTasks";

describe("validateTask", () => {
  const valid = {
    title: "Site visit",
    description: "Check the shutter",
    target_lat: "24.86",
    target_lng: "67.01",
    target_address: "Clifton",
    radius_meters: "150",
  };

  it("accepts a fully specified task", () => {
    const { errors, value } = validateTask(valid);
    expect(Object.keys(errors)).toHaveLength(0);
    expect(value).toMatchObject({
      title: "Site visit",
      description: "Check the shutter",
      has_pin: true,
      target_lat: 24.86,
      target_lng: 67.01,
      target_address: "Clifton",
      radius_meters: 150,
    });
  });

  it("requires a title", () => {
    expect(validateTask({ ...valid, title: "   " }).errors.title).toBeTruthy();
  });

  it("rejects an over-long title", () => {
    expect(validateTask({ ...valid, title: "x".repeat(MAX_TITLE_LENGTH + 1) }).errors.title).toBeTruthy();
  });

  it("rejects out-of-range coordinates", () => {
    expect(validateTask({ ...valid, target_lat: "91" }).errors.target_lat).toBeTruthy();
    expect(validateTask({ ...valid, target_lat: "-91" }).errors.target_lat).toBeTruthy();
    expect(validateTask({ ...valid, target_lng: "181" }).errors.target_lng).toBeTruthy();
    expect(validateTask({ ...valid, target_lng: "-181" }).errors.target_lng).toBeTruthy();
  });

  it("allows the boundary coordinates", () => {
    expect(validateTask({ ...valid, target_lat: "90", target_lng: "180" }).errors.target_lat).toBeUndefined();
    expect(validateTask({ ...valid, target_lat: "-90", target_lng: "-180" }).errors.target_lng).toBeUndefined();
  });

  it("treats 0,0 as a real coordinate rather than missing", () => {
    // The Gulf of Guinea is a legitimate pin and `if (!lat)` would drop it.
    const { value } = validateTask({ ...valid, target_lat: "0", target_lng: "0" });
    expect(value.has_pin).toBe(true);
    expect(value.target_lat).toBe(0);
    expect(value.target_lng).toBe(0);
  });

  it("allows a task with no pin at all", () => {
    const { errors, value } = validateTask({ title: "Call the client", target_lat: "", target_lng: "" });
    expect(Object.keys(errors)).toHaveLength(0);
    expect(value.has_pin).toBe(false);
    expect(value.target_lat).toBeNull();
    expect(value.target_lng).toBeNull();
  });

  it("defaults the radius to 100 metres", () => {
    expect(validateTask({ ...valid, radius_meters: "" }).value.radius_meters).toBe(100);
    expect(validateTask({ title: "x", target_lat: "", target_lng: "" }).value.radius_meters).toBe(100);
  });

  it("accepts a zero radius", () => {
    // "Arrive exactly here" is a real requirement, so 0 is not a missing value.
    expect(validateTask({ ...valid, radius_meters: "0" }).value.radius_meters).toBe(0);
  });

  it("rejects a negative radius", () => {
    expect(validateTask({ ...valid, radius_meters: "-5" }).errors.radius_meters).toBeTruthy();
  });

  it("normalises a due date to an ISO string", () => {
    expect(validateTask({ ...valid, due_at: "2026-05-01T09:00:00Z" }).value.due_at).toBe("2026-05-01T09:00:00.000Z");
  });

  it("rejects an unparseable due date", () => {
    expect(validateTask({ ...valid, due_at: "next tuesday" }).errors.due_at).toBeTruthy();
  });

  it("leaves the due date null when absent", () => {
    expect(validateTask(valid).value.due_at).toBeNull();
  });

  it("returns no value when anything is wrong", () => {
    expect(validateTask({}).value).toBeNull();
    expect(validateTask().value).toBeNull();
  });

  it("knows only the statuses the check constraint allows", () => {
    expect(TASK_STATUSES).toEqual(["pending", "in_progress", "completed", "cancelled"]);
    for (const s of TASK_STATUSES) expect(TASK_STATUS_META[s]).toBeTruthy();
  });
});

describe("resolveAssignee", () => {
  // tasks.employee_id points at profiles, so an employee with no profile id
  // cannot hold a task. This is the one place the two employee identities meet.
  it("maps an employee to their profile id", () => {
    expect(resolveAssignee({ id: "e1", profile_id: "p1" })).toEqual({ profileId: "p1", employeeId: "e1" });
  });

  it("refuses an employee with no linked profile", () => {
    expect(resolveAssignee({ id: "e1", profile_id: null }).error).toBe("employee_has_no_profile");
  });

  it("refuses an inactive employee", () => {
    expect(resolveAssignee({ id: "e1", profile_id: "p1", is_active: false }).error).toBe("employee_inactive");
  });

  it("reports a missing employee rather than throwing", () => {
    expect(resolveAssignee(null).error).toBe("missing_employee");
    expect(resolveAssignee(undefined).error).toBe("missing_employee");
  });

  it("prefers the profile error over nothing when profile_id is undefined", () => {
    // `profile_id` absent means not-yet-invited, same as explicit null.
    expect(resolveAssignee({ id: "e1" }).error).toBe("employee_has_no_profile");
  });
});

describe("task status transitions", () => {
  it("allows the normal working path", () => {
    expect(canTransition("pending", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
  });

  it("allows completing straight from pending", () => {
    // A task can be done on arrival; forcing a status change is just taps.
    expect(canTransition("pending", "completed")).toBe(true);
  });

  it("allows cancelling from either open state", () => {
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("in_progress", "cancelled")).toBe(true);
  });

  it("does not allow reopening a finished task", () => {
    // completed_at would otherwise contradict the new status.
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("completed", "pending")).toBe(false);
    expect(nextStatuses("completed")).toEqual([]);
  });

  it("does not allow un-cancelling", () => {
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(canTransition("cancelled", "in_progress")).toBe(false);
  });

  it("refuses to skip backwards", () => {
    expect(canTransition("in_progress", "pending")).toBe(false);
  });

  it("treats a no-op transition as not a transition", () => {
    for (const s of TASK_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("refuses an unknown status", () => {
    expect(canTransition("archived", "pending")).toBe(false);
    expect(canTransition(undefined, "pending")).toBe(false);
    expect(nextStatuses("archived")).toEqual([]);
  });

  it("knows which statuses are still open", () => {
    expect(isOpen("pending")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
    expect(isOpen("completed")).toBe(false);
    expect(isOpen("cancelled")).toBe(false);
  });
});

describe("task filtering and sorting", () => {
  it("treats open as a filter over two statuses", () => {
    expect(matchesStatusFilter({ status: "pending" }, "open")).toBe(true);
    expect(matchesStatusFilter({ status: "in_progress" }, "open")).toBe(true);
    expect(matchesStatusFilter({ status: "completed" }, "open")).toBe(false);
  });

  it("passes everything with no filter", () => {
    for (const s of TASK_STATUSES) {
      expect(matchesStatusFilter({ status: s }, "all")).toBe(true);
      expect(matchesStatusFilter({ status: s }, null)).toBe(true);
    }
  });

  it("puts open work first, then soonest due", () => {
    const rows = [
      { id: "a", status: "completed", due_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01" },
      { id: "b", status: "pending", due_at: "2026-06-01T00:00:00Z", created_at: "2026-01-01" },
      { id: "c", status: "in_progress", due_at: "2026-05-01T00:00:00Z", created_at: "2026-01-01" },
    ];
    expect(sortTasks(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts undated tasks after dated ones", () => {
    const rows = [
      { id: "x", status: "pending", due_at: null, created_at: "2026-01-01" },
      { id: "y", status: "pending", due_at: "2026-05-01T00:00:00Z", created_at: "2026-01-01" },
    ];
    expect(sortTasks(rows).map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("does not mutate the input and handles an empty list", () => {
    const rows = [
      { id: "1", status: "completed", due_at: null, created_at: "1" },
      { id: "2", status: "pending", due_at: null, created_at: "2" },
    ];
    const before = rows.map((r) => r.id);
    sortTasks(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
    expect(sortTasks()).toEqual([]);
  });
});