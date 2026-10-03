import { describe, it, expect } from "vitest";
import {
  cnicPattern,
  phonePattern,
  normalizeCnic,
  normalizePhone,
  cnicSchema,
  phoneSchema,
  passwordChecklist,
  isPasswordValid,
  appPasswordSchema,
  employeeSchema,
  geofenceSchema,
  fieldErrors,
  policySchemaFor,
} from "@/lib/monitor/validation";

describe("CNIC", () => {
  it("accepts the dashed 13-digit format", () => {
    expect(cnicPattern.test("35202-1234567-1")).toBe(true);
  });

  it("accepts the undashed format", () => {
    expect(cnicPattern.test("3520212345671")).toBe(true);
  });

  it("rejects a wrong length", () => {
    expect(cnicPattern.test("35202-123456-1")).toBe(false);
  });

  it("rejects letters", () => {
    expect(cnicPattern.test("35202-1234567-x")).toBe(false);
  });

  it("normalises to the dashed form", () => {
    expect(normalizeCnic("3520212345671")).toBe("35202-1234567-1");
    expect(normalizeCnic("35202-1234567-1")).toBe("35202-1234567-1");
  });

  it("validates through the schema", () => {
    expect(cnicSchema.safeParse("35202-1234567-1").success).toBe(true);
    expect(cnicSchema.safeParse("nope").success).toBe(false);
  });
});

describe("Pakistani phone numbers", () => {
  it("accepts 03xx with dashes", () => {
    expect(phonePattern.test("0300-1234567")).toBe(true);
  });

  it("accepts +92 with dashes", () => {
    expect(phonePattern.test("+92300-1234567")).toBe(true);
  });

  it("accepts an undashed number", () => {
    expect(phonePattern.test("03001234567")).toBe(true);
  });

  it("rejects a landline", () => {
    expect(phonePattern.test("052-1234567")).toBe(false);
  });

  it("rejects a foreign number", () => {
    expect(phonePattern.test("+14155552671")).toBe(false);
  });

  it("normalises +92 to the local 03xx form", () => {
    expect(normalizePhone("+923001234567")).toBe("0300-1234567");
  });

  it("keeps an already-local number normalised", () => {
    expect(normalizePhone("03001234567")).toBe("0300-1234567");
  });

  it("validates through the schema", () => {
    expect(phoneSchema.safeParse("0300-1234567").success).toBe(true);
    expect(phoneSchema.safeParse("12345").success).toBe(false);
  });
});

describe("app password policy", () => {
  it("reports every unmet rule", () => {
    const checklist = passwordChecklist("abc");
    expect(checklist.some((c) => !c.ok)).toBe(true);
  });

  it("passes a strong password", () => {
    expect(isPasswordValid("Str0ng-Pass!2026")).toBe(true);
  });

  it("rejects a password under the minimum length", () => {
    expect(isPasswordValid("Ab1!")).toBe(false);
  });

  it("rejects a password with no letter", () => {
    expect(isPasswordValid("12345678")).toBe(false);
  });

  it("rejects a password with no number", () => {
    expect(isPasswordValid("abcdefgh")).toBe(false);
  });

  it("gives each rule a label and a test", () => {
    for (const rule of passwordChecklist("")) {
      expect(typeof rule.label).toBe("string");
      expect(typeof rule.ok).toBe("boolean");
    }
  });

  it("enforces the policy in the schema", () => {
    expect(appPasswordSchema.safeParse("Str0ng-Pass!2026").success).toBe(true);
    expect(appPasswordSchema.safeParse("weak").success).toBe(false);
  });

  it("never returns the password inside the checklist", () => {
    expect(JSON.stringify(passwordChecklist("secret123"))).not.toContain("secret123");
  });
});

describe("employeeSchema", () => {
  const valid = {
    emp_code: "EMP-0001",
    name: "Ali Raza",
    father_husband_name: "Muhammad Raza",
    gender: "male",
    cnic: "35202-1234567-1",
    contact_no: "0300-1234567",
    email: "ali@example.com",
    hire_date: "2024-01-15",
    department_id: "3f1a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
    designation_id: "2a1b1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
    shift_start: "09:00",
    shift_end: "17:00",
    basic_salary: 30000,
    app_password: "Str0ng-Pass!2026",
    geofencing_enabled: "yes",
  };

  it("accepts a complete employee", () => {
    expect(employeeSchema.safeParse(valid).success).toBe(true);
  });

  it("coerces the yes/no geofencing radio into the boolean column type", () => {
    expect(employeeSchema.parse(valid).geofencing_enabled).toBe(true);
    expect(employeeSchema.parse({ ...valid, geofencing_enabled: "no" }).geofencing_enabled).toBe(false);
  });

  it("accepts a real boolean for geofencing_enabled too", () => {
    expect(employeeSchema.parse({ ...valid, geofencing_enabled: true }).geofencing_enabled).toBe(true);
  });

  it("requires an employee ID", () => {
    expect(employeeSchema.safeParse({ ...valid, emp_code: "" }).success).toBe(false);
  });

  it("requires a designation", () => {
    expect(employeeSchema.safeParse({ ...valid, designation_id: "" }).success).toBe(false);
  });

  it("requires a name", () => {
    const r = employeeSchema.safeParse({ ...valid, name: "" });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error).name).toBeTruthy();
  });

  it("requires a valid CNIC", () => {
    expect(employeeSchema.safeParse({ ...valid, cnic: "123" }).success).toBe(false);
  });

  it("requires a valid contact number", () => {
    expect(employeeSchema.safeParse({ ...valid, contact_no: "12345" }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(employeeSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("requires a weak app password to be rejected", () => {
    expect(employeeSchema.safeParse({ ...valid, app_password: "weak" }).success).toBe(false);
  });

  it("collects errors by field name for the form", () => {
    const r = employeeSchema.safeParse({ ...valid, cnic: "bad", contact_no: "bad" });
    const errors = fieldErrors(r.error);
    expect(errors.cnic).toBeTruthy();
    expect(errors.contact_no).toBeTruthy();
    expect(errors.name).toBeUndefined();
  });

  it("validates a geofence circle", () => {
    const r = geofenceSchema.safeParse({
      name: "Sialkot Head Office",
      type: "circle",
      center_lat: 32.4945,
      center_lng: 74.5229,
      radius_m: 250,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a circle with no radius", () => {
    const r = geofenceSchema.safeParse({
      name: "Nowhere",
      type: "circle",
      center_lat: 32.4945,
      center_lng: 74.5229,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a polygon with fewer than three points", () => {
    const r = geofenceSchema.safeParse({
      name: "Sliver",
      type: "polygon",
      geometry: { type: "Polygon", coordinates: [[[74.5, 32.4], [74.6, 32.5]]] },
    });
    expect(r.success).toBe(false);
  });
});

describe("policySchemaFor", () => {
  it("builds a schema for a known policy type", () => {
    expect(policySchemaFor("late_deduction")).toBeTruthy();
  });

  it("still produces a schema for an unknown type", () => {
    expect(() => policySchemaFor("something_new")).not.toThrow();
  });
});
