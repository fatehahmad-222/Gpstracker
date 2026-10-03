import { describe, it, expect } from "vitest";

import {
  minutesFromMidnight,
  midnightToTime,
  isOvernight,
  toEmployeeRow,
  fromEmployeeRow,
} from "@/lib/monitor/employee-mapper";

describe("shift time conversion", () => {
  it("converts HH:MM to minutes from midnight", () => {
    expect(minutesFromMidnight("09:00")).toBe(540);
    expect(minutesFromMidnight("17:30")).toBe(1050);
    expect(minutesFromMidnight("00:00")).toBe(0);
    expect(minutesFromMidnight("23:59")).toBe(1439);
  });

  it("tolerates a single-digit hour", () => {
    expect(minutesFromMidnight("9:05")).toBe(545);
  });

  it("rejects an out-of-range or malformed time", () => {
    expect(minutesFromMidnight("24:00")).toBeNull();
    expect(minutesFromMidnight("9:60")).toBeNull();
    expect(minutesFromMidnight("")).toBeNull();
    expect(minutesFromMidnight("nine")).toBeNull();
  });

  it("converts minutes back to a zero-padded HH:MM", () => {
    expect(midnightToTime(540)).toBe("09:00");
    expect(midnightToTime(1050)).toBe("17:30");
    expect(midnightToTime(0)).toBe("00:00");
    // 21:30 is the overnight case called out in the schema comment.
    expect(midnightToTime(1290)).toBe("21:30");
  });

  it("round-trips every half hour of the day", () => {
    for (let minutes = 0; minutes < 1440; minutes += 30) {
      expect(minutesFromMidnight(midnightToTime(minutes))).toBe(minutes);
    }
  });

  it("detects an overnight shift", () => {
    expect(isOvernight(1290, 360)).toBe(true); // 21:30 -> 06:00
    expect(isOvernight(540, 1020)).toBe(false); // 09:00 -> 17:00
  });
});

const FORM = {
  emp_code: "EMP-001",
  name: "Ali Raza",
  father_husband_name: "Muhammad Raza",
  dob: "1990-04-02",
  gender: "male",
  marital_status: "married",
  cnic: "3520212345671",
  contact_no: "03001234567",
  email: "ali@example.com",
  address: "Lahore",
  hire_date: "2024-01-15",
  education: "BSc",
  department_id: "d1",
  designation_id: "g1",
  last_job_history: "",
  shift_start: "09:00",
  shift_end: "17:00",
  overnight_approved: false,
  basic_salary: 45000,
  payment_method: "bank",
  late_deduction: true,
  overtime_allowed: true,
  absent_deduction: false,
  wht_tax: true,
  geofencing_enabled: true,
  geofence_ids: [],
  attendance_source: "GPS APP",
  photo_url: "",
  tracking_consent: true,
};

describe("toEmployeeRow", () => {
  it("stores shift times as minutes from midnight", () => {
    const row = toEmployeeRow(FORM);
    expect(row.shift_start).toBe(540);
    expect(row.shift_end).toBe(1020);
  });

  it("renames contact_no to phone and normalises it", () => {
    const row = toEmployeeRow(FORM);
    expect(row.contact_no).toBeUndefined();
    expect(row.phone).toBe("0300-1234567");
  });

  it("normalises a +92 number to the same canonical form", () => {
    expect(toEmployeeRow({ ...FORM, contact_no: "+923001234567" }).phone).toBe("0300-1234567");
  });

  it("normalises the CNIC to the dashed form", () => {
    expect(toEmployeeRow(FORM).cnic).toBe("35202-1234567-1");
  });

  it("flags an overnight shift even when the box was not ticked", () => {
    const row = toEmployeeRow({ ...FORM, shift_start: "21:30", shift_end: "06:00" });
    expect(row.overnight_allowed).toBe(true);
  });

  it("honours an explicit overnight approval on a same-day shift", () => {
    const row = toEmployeeRow({ ...FORM, overnight_approved: true });
    expect(row.overnight_allowed).toBe(true);
  });

  it("writes null rather than an empty string for optional text", () => {
    const row = toEmployeeRow({
      ...FORM,
      address: "",
      education: "",
      payment_method: "",
      dob: "",
      marital_status: "",
    });
    expect(row.address).toBeNull();
    expect(row.education).toBeNull();
    expect(row.payment_method).toBeNull();
    expect(row.dob).toBeNull();
    expect(row.marital_status).toBeNull();
  });

  it("coerces the checkbox values to booleans", () => {
    const row = toEmployeeRow({ ...FORM, geofencing_enabled: "yes", tracking_consent: 1 });
    expect(row.geofencing_enabled).toBe(true);
    expect(row.tracking_consent).toBe(true);
  });

  it("never carries the app password hash or company id", () => {
    const row = toEmployeeRow({ ...FORM, app_password: "Secret123!" });
    expect(row.app_password_hash).toBeUndefined();
    expect(row.app_password).toBeUndefined();
  });

  it("defaults the attendance source when blank", () => {
    expect(toEmployeeRow({ ...FORM, attendance_source: "" }).attendance_source).toBe("GPS APP");
  });
});

describe("fromEmployeeRow", () => {
  it("is the inverse of toEmployeeRow for the fields the form shows", () => {
    const round = fromEmployeeRow(toEmployeeRow(FORM));

    expect(round.shift_start).toBe("09:00");
    expect(round.shift_end).toBe("17:00");
    expect(round.contact_no).toBe("0300-1234567");
    expect(round.cnic).toBe("35202-1234567-1");
    expect(round.emp_code).toBe(FORM.emp_code);
    expect(round.name).toBe(FORM.name);
    expect(round.basic_salary).toBe(45000);
    expect(round.late_deduction).toBe(true);
    expect(round.wht_tax).toBe(true);
    expect(round.tracking_consent).toBe(true);
  });

  it("round-trips an overnight shift", () => {
    const night = { ...FORM, shift_start: "21:30", shift_end: "06:00" };
    const round = fromEmployeeRow(toEmployeeRow(night));

    expect(round.shift_start).toBe("21:30");
    expect(round.shift_end).toBe("06:00");
    expect(round.overnight_approved).toBe(true);
  });

  it("supplies safe defaults for a sparse row", () => {
    const round = fromEmployeeRow({ emp_code: "EMP-9", name: "Test" });
    expect(round.shift_start).toBe("09:00");
    expect(round.shift_end).toBe("17:00");
    expect(round.gender).toBe("male");
    expect(round.overtime_allowed).toBe(true);
    expect(round.geofencing_enabled).toBe(true);
    expect(round.geofence_ids).toEqual([]);
  });

  it("returns an empty string for a null column rather than crashing", () => {
    const round = fromEmployeeRow({ name: "Test", phone: null, cnic: null, dob: null });
    expect(round.contact_no).toBe("");
    expect(round.cnic).toBe("");
    expect(round.dob).toBe("");
  });

  it("passes the assigned geofences through", () => {
    const round = fromEmployeeRow({ name: "Test" }, { geofenceIds: ["f1", "f2"] });
    expect(round.geofence_ids).toEqual(["f1", "f2"]);
  });
});