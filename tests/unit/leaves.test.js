import { describe, it, expect } from "vitest";

import {
  validateLeaveRequest,
  countDays,
  overlapsExisting,
  canDecide,
  nextStatus,
  matchesStatusFilter,
  sortLeaves,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  LEAVE_STATUS_META,
  MAX_REASON_LENGTH,
} from "@/lib/monitor/leaves";

describe("validateLeaveRequest", () => {
  it("accepts a well-formed request", () => {
    const { errors, value } = validateLeaveRequest({
      employee_id: "e1",
      leave_type: "sick",
      from_date: "2026-03-02",
      to_date: "2026-03-04",
      reason: "  fever  ",
    });
    expect(Object.keys(errors)).toHaveLength(0);
    expect(value).toMatchObject({
      employee_id: "e1",
      leave_type: "sick",
      from_date: "2026-03-02",
      to_date: "2026-03-04",
      reason: "fever",
      days: 3,
    });
  });

  it("defaults an unknown or missing leave type to casual", () => {
    const { value } = validateLeaveRequest({
      employee_id: "e1",
      leave_type: "vacation-in-hawaii",
      from_date: "2026-03-02",
      to_date: "2026-03-02",
    });
    expect(value.leave_type).toBe("casual");
  });

  it("stores an empty reason as null rather than an empty string", () => {
    const { value } = validateLeaveRequest({
      employee_id: "e1",
      from_date: "2026-03-02",
      to_date: "2026-03-02",
      reason: "   ",
    });
    expect(value.reason).toBeNull();
  });

  it("requires an employee", () => {
    const { errors, value } = validateLeaveRequest({ from_date: "2026-03-02", to_date: "2026-03-02" });
    expect(errors.employee_id).toBeTruthy();
    expect(value).toBeNull();
  });

  it("requires both dates in ISO form", () => {
    const { errors } = validateLeaveRequest({ employee_id: "e1", from_date: "02/03/2026" });
    expect(errors.from_date).toBeTruthy();
    expect(errors.to_date).toBeTruthy();
  });

  it("rejects an end date before the start date", () => {
    const { errors } = validateLeaveRequest({
      employee_id: "e1",
      from_date: "2026-03-10",
      to_date: "2026-03-01",
    });
    expect(errors.to_date).toMatch(/before/i);
  });

  it("accepts a single-day request", () => {
    const { errors, value } = validateLeaveRequest({
      employee_id: "e1",
      from_date: "2026-03-10",
      to_date: "2026-03-10",
    });
    expect(Object.keys(errors)).toHaveLength(0);
    expect(value.days).toBe(1);
  });

  it("allows a request ending exactly on the start date's month boundary", () => {
    // Catches a lexical comparison that compared only the month.
    const { value } = validateLeaveRequest({
      employee_id: "e1",
      from_date: "2026-01-31",
      to_date: "2026-02-01",
    });
    expect(value.days).toBe(2);
  });

  it("rejects an over-long reason", () => {
    const { errors } = validateLeaveRequest({
      employee_id: "e1",
      from_date: "2026-03-02",
      to_date: "2026-03-02",
      reason: "x".repeat(MAX_REASON_LENGTH + 1),
    });
    expect(errors.reason).toBeTruthy();
  });

  it("returns no value when anything is wrong", () => {
    // A partial request must never reach the database.
    for (const bad of [
      {},
      { employee_id: "e1" },
      { employee_id: "e1", from_date: "nope", to_date: "nope" },
      { employee_id: "", from_date: "2026-01-01", to_date: "2026-01-01" },
    ]) {
      expect(validateLeaveRequest(bad).value).toBeNull();
    }
  });

  it("handles being called with nothing", () => {
    expect(validateLeaveRequest().value).toBeNull();
  });

  it("only knows the leave types the table allows", () => {
    expect(LEAVE_TYPES).toEqual(["casual", "sick", "annual"]);
  });
});

describe("countDays", () => {
  it("counts inclusively", () => {
    expect(countDays("2026-03-02", "2026-03-02")).toBe(1);
    expect(countDays("2026-03-02", "2026-03-08")).toBe(7);
  });

  it("spans month and year boundaries", () => {
    expect(countDays("2026-12-30", "2027-01-02")).toBe(4);
    expect(countDays("2024-02-28", "2024-03-01")).toBe(3); // leap year
  });

  it("does not drift across timezones", () => {
    // Comparing local Dates here would shift this to 0 days or 3 days depending on
    // the machine's offset, which is why the helper parses at UTC midnight.
    expect(countDays("2026-03-02", "2026-03-03")).toBe(2);
  });

  it("returns 0 for unparseable input", () => {
    expect(countDays("x", "2026-03-03")).toBe(0);
    expect(countDays(null, null)).toBe(0);
  });
});

describe("overlapsExisting", () => {
  const req = { from_date: "2026-03-10", to_date: "2026-03-12" };

  it("detects a fully contained request", () => {
    expect(overlapsExisting(req, [{ from_date: "2026-03-09", to_date: "2026-03-20" }])).toBe(true);
  });

  it("detects partial overlap on either side", () => {
    expect(overlapsExisting(req, [{ from_date: "2026-03-11", to_date: "2026-03-30" }])).toBe(true);
    expect(overlapsExisting(req, [{ from_date: "2026-02-20", to_date: "2026-03-11" }])).toBe(true);
  });

  it("detects an identical request", () => {
    expect(overlapsExisting(req, [{ ...req }])).toBe(true);
  });

  it("treats adjacent, non-overlapping requests as clear", () => {
    expect(overlapsExisting(req, [{ from_date: "2026-03-07", to_date: "2026-03-09" }])).toBe(false);
    expect(overlapsExisting(req, [{ from_date: "2026-03-13", to_date: "2026-03-20" }])).toBe(false);
  });

  it("ignores rejected requests", () => {
    // Re-asking for the same days after a rejection has to be possible.
    expect(overlapsExisting(req, [{ ...req, status: "rejected" }])).toBe(false);
  });

  it("counts an approved request as an overlap", () => {
    expect(overlapsExisting(req, [{ ...req, status: "approved" }])).toBe(true);
  });

  it("still reports an overlap against a pending request", () => {
    expect(overlapsExisting(req, [{ ...req, status: "pending" }])).toBe(true);
  });

  it("is safe with junk input", () => {
    expect(overlapsExisting(req, [])).toBe(false);
    expect(overlapsExisting(req, [{}])).toBe(false);
    expect(overlapsExisting({}, [{ ...req }])).toBe(false);
  });
});

describe("leave decisions", () => {
  it("only allows a decision on a pending request", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canDecide("approved")).toBe(false);
    expect(canDecide("rejected")).toBe(false);
    expect(canDecide(undefined)).toBe(false);
  });

  it("maps an action to a status", () => {
    expect(nextStatus("pending", "approve")).toBe("approved");
    expect(nextStatus("pending", "reject")).toBe("rejected");
  });

  it("refuses to transition an already-decided request", () => {
    // Otherwise approving twice would report success while changing nothing.
    expect(nextStatus("approved", "reject")).toBeNull();
    expect(nextStatus("rejected", "approve")).toBeNull();
  });

  it("ignores an unrecognised action", () => {
    expect(nextStatus("pending", "delete")).toBeNull();
    expect(nextStatus("pending", undefined)).toBeNull();
  });

  it("knows only the three statuses the check constraint allows", () => {
    expect(LEAVE_STATUSES).toEqual(["pending", "approved", "rejected"]);
    for (const s of LEAVE_STATUSES) {
      expect(LEAVE_STATUS_META[s]).toBeTruthy();
    }
  });
});

describe("matchesStatusFilter", () => {
  it("passes everything with no filter", () => {
    for (const s of LEAVE_STATUSES) {
      expect(matchesStatusFilter({ status: s }, "all")).toBe(true);
      expect(matchesStatusFilter({ status: s }, null)).toBe(true);
    }
  });

  it("filters to a single status", () => {
    expect(matchesStatusFilter({ status: "pending" }, "pending")).toBe(true);
    expect(matchesStatusFilter({ status: "pending" }, "approved")).toBe(false);
  });
});

describe("sortLeaves", () => {
  it("puts pending work first, then newest start date", () => {
    const rows = [
      { id: "1", status: "approved", from_date: "2026-03-20" },
      { id: "2", status: "pending", from_date: "2026-03-01" },
      { id: "3", status: "pending", from_date: "2026-03-15" },
      { id: "4", status: "rejected", from_date: "2026-03-25" },
    ];
    // Pending first, regardless of date, so the queue someone has to work through
    // is at the top. Decided rows then sort purely newest-first, so a recently
    // rejected request outranks an older approved one.
    expect(sortLeaves(rows).map((r) => r.id)).toEqual(["3", "2", "4", "1"]);
  });

  it("does not mutate the input", () => {
    const rows = [{ id: "2", status: "pending", from_date: "2026-03-01" }, { id: "1", status: "pending", from_date: "2026-03-09" }];
    const before = rows.map((r) => r.id);
    sortLeaves(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("handles an empty list", () => {
    expect(sortLeaves()).toEqual([]);
    expect(sortLeaves([])).toEqual([]);
  });
});