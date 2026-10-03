import { describe, it, expect } from "vitest";

import { splitCsvLine, toCsv, escapeCsvValue } from "@/lib/monitor/csv";
import { EMPLOYEE_CSV_COLUMNS, canonicalHeader, parseYesNo } from "@/lib/monitor/csv-columns";
import { parseEmployeeCsv, FIELD_BY_LABEL } from "@/lib/monitor/employees-csv";

describe("splitCsvLine", () => {
  it("splits plain cells", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside a quoted cell", () => {
    expect(splitCsvLine('Ali,"Lahore, Pakistan"')).toEqual(["Ali", "Lahore, Pakistan"]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"He said ""hi"""')).toEqual(['He said "hi"']);
  });

  it("trims surrounding whitespace from cells", () => {
    expect(splitCsvLine(" a , b ")).toEqual(["a", "b"]);
  });

  it("keeps empty cells so columns stay aligned", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
    expect(splitCsvLine(",")).toEqual(["", ""]);
  });
});

describe("canonicalHeader", () => {
  it("maps the export labels to themselves", () => {
    for (const column of EMPLOYEE_CSV_COLUMNS) {
      expect(canonicalHeader(column.label)).toBe(column.label);
    }
  });

  it("ignores case, spaces, hyphens and underscores", () => {
    expect(canonicalHeader("employee id")).toBe("Employee ID");
    expect(canonicalHeader("employee_id")).toBe("Employee ID");
    expect(canonicalHeader("Employee-ID")).toBe("Employee ID");
    expect(canonicalHeader("  EMPLOYEE ID ")).toBe("Employee ID");
  });

  it("accepts common hand-written alternatives", () => {
    expect(canonicalHeader("Emp Code")).toBe("Employee ID");
    expect(canonicalHeader("Full Name")).toBe("Name");
    expect(canonicalHeader("Mobile")).toBe("Contact No");
    expect(canonicalHeader("Joining Date")).toBe("Hiring Date");
    expect(canonicalHeader("Job Title")).toBe("Designation");
    expect(canonicalHeader("Salary")).toBe("Basic Salary");
  });

  it("leaves an unknown header alone so it can be reported", () => {
    expect(canonicalHeader("Favourite Colour")).toBe("Favourite Colour");
  });
});

describe("parseYesNo", () => {
  it("reads the usual spellings", () => {
    for (const yes of ["yes", "Y", "TRUE", "1", "on", "Enabled"]) {
      expect(parseYesNo(yes)).toBe(true);
    }
    for (const no of ["no", "N", "false", "0", "off", "Disabled"]) {
      expect(parseYesNo(no)).toBe(false);
    }
  });

  it("returns null for anything else", () => {
    expect(parseYesNo("maybe")).toBeNull();
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo(undefined)).toBeNull();
  });
});

describe("parseEmployeeCsv", () => {
  // Built from the column list rather than typed out, so a column can be added
  // or removed without silently shifting every cell in these fixtures.
  const HEADER = EMPLOYEE_CSV_COLUMNS.map((c) => c.label).join(",");

  const csvOf = (...rows) => [HEADER, ...rows].join("\n");
  const rowOf = (values) => toCsv([values], EMPLOYEE_CSV_COLUMNS).split("\n")[1];

  const ALI = {
    emp_code: "EMP-001",
    name: "Ali Raza",
    gender: "male",
    dob: "1990-04-02",
    hire_date: "2024-01-15",
    department: "Sales",
    designation: "Driver",
    shift_start: "09:00",
    shift_end: "17:00",
    basic_salary: 45000,
    payment_method: "bank",
    contact_no: "03001234567",
    geofencing_enabled: "yes",
    attendance_source: "GPS APP",
    status: "active",
  };

  it("maps display labels to schema field names", () => {
    const { rows, errors } = parseEmployeeCsv(csvOf(rowOf(ALI)));

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);

    const { values } = rows[0];
    expect(values.emp_code).toBe("EMP-001");
    expect(values.name).toBe("Ali Raza");
    expect(values.department).toBe("Sales");
    expect(values.designation).toBe("Driver");
    expect(values.basic_salary).toBe("45000");
    expect(values.shift_start).toBe("09:00");
    expect(values.geofencing_enabled).toBe(true);
  });

  it("keeps department and designation as names for the route to resolve", () => {
    const { rows } = parseEmployeeCsv(csvOf(rowOf(ALI)));
    expect(rows[0].values.department).toBe("Sales");
    expect(rows[0].values.designation).toBe("Driver");
  });

  it("rejects a row with no name or id", () => {
    const { rows, errors } = parseEmployeeCsv(csvOf(rowOf({ emp_code: "", name: "" }), rowOf({ emp_code: "EMP-002", name: "Bilal" })));
    expect(rows).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].issues.map((i) => i.field)).toEqual(["name", "emp_code"]);
  });

  it("ignores blank lines but keeps the original line numbers", () => {
    const { rows, errors } = parseEmployeeCsv(`\n${HEADER}\n\n${rowOf(ALI)}\n\n`);
    expect(rows).toHaveLength(1);
    // Header is on line 2 of the original file, so the data row is line 4.
    expect(rows[0].line).toBe(4);
    expect(errors).toEqual([]);
  });

  it("strips the UTF-8 BOM Excel adds", () => {
    const { rows, errors } = parseEmployeeCsv(`\uFEFF${HEADER}\nEMP-001,Ali`);
    expect(errors).toEqual([]);
    expect(rows[0].values.name).toBe("Ali");
  });

  it("reports a file with no recognisable columns", () => {
    const { rows, errors } = parseEmployeeCsv("Colour,Size\nred,large");
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/No recognisable employee columns/);
  });

  it("reports an empty file", () => {
    const { rows, errors } = parseEmployeeCsv("");
    expect(rows).toEqual([]);
    expect(errors[0].message).toBe("The file is empty");
  });

  it("notes unknown columns but still imports the known ones", () => {
    const { rows, errors } = parseEmployeeCsv(`${HEADER},Favourite Colour\n${rowOf(ALI)},red`);
    expect(rows).toHaveLength(1);
    expect(rows[0].values.name).toBe("Ali Raza");
    expect(errors[0].message).toMatch(/Ignored unrecognised columns: Favourite Colour/);
    expect(errors[0].label).toBe("header");
  });

  it("coerces the typed columns", () => {
    const { rows } = parseEmployeeCsv(
      csvOf(rowOf({ ...ALI, gender: "Male", status: "Active", geofencing_enabled: "on" }))
    );
    expect(rows[0].values.gender).toBe("male");
    expect(rows[0].values.status).toBe("active");
    expect(rows[0].values.geofencing_enabled).toBe(true);
  });

  it("treats an unreadable Geo-Fencing cell as off rather than guessing", () => {
    const { rows } = parseEmployeeCsv(csvOf(rowOf({ ...ALI, geofencing_enabled: "maybe" })));
    expect(rows[0].values.geofencing_enabled).toBe(false);
  });

  it("accepts aliased headers", () => {
    const { rows, errors } = parseEmployeeCsv("Emp Code,Full Name,Mobile,Department,Job Title\nE1,Ali,03001234567,Sales,Driver");
    expect(errors).toEqual([]);
    expect(rows[0].values).toMatchObject({
      emp_code: "E1",
      name: "Ali",
      contact_no: "03001234567",
      department: "Sales",
      designation: "Driver",
    });
  });

  it("names a row by its id so the report is readable", () => {
    const { errors } = parseEmployeeCsv(csvOf(rowOf({ ...ALI, name: "" })));
    expect(errors[0].label).toBe("EMP-001");
  });
});

describe("export/import round trip", () => {
  it("re-imports its own export without losing a field", () => {
    const row = {
      emp_code: "EMP-001",
      name: "Ali, Raza",
      father_husband_name: 'Muhammad "Ali" Raza',
      cnic: "35202-1234567-1",
      contact_no: "03001234567",
      email: "ali@example.com",
      gender: "male",
      marital_status: "married",
      dob: "1990-04-02",
      hire_date: "2024-01-15",
      department: "Sales",
      designation: "Field Officer",
      shift_start: "09:00",
      shift_end: "17:00",
      basic_salary: 45000,
      payment_method: "bank",
      education: "BSc",
      address: "Lahore, Punjab",
      geofencing_enabled: "yes",
      attendance_source: "GPS APP",
      status: "active",
    };

    const csv = toCsv([row], EMPLOYEE_CSV_COLUMNS);
    const { rows, errors } = parseEmployeeCsv(csv);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);

    // Every column that has a schema field must survive the trip unchanged. CSV has
    // no types, so numbers come back as the strings Zod then coerces, and the
    // checkbox columns are normalised to booleans on the way in.
    const COERCED = new Set(["geofencing_enabled"]);
    const { values } = rows[0];
    for (const column of EMPLOYEE_CSV_COLUMNS) {
      if (COERCED.has(column.key)) continue;
      expect(values[column.key]).toBe(String(row[column.key]));
    }
    expect(values.geofencing_enabled).toBe(true);

    // Names containing a comma or a quote must survive intact.
    expect(values.name).toBe("Ali, Raza");
    expect(values.father_husband_name).toBe('Muhammad "Ali" Raza');
    expect(values.address).toBe("Lahore, Punjab");
  });

  it("maps every export column to a field the importer knows", () => {
    for (const column of EMPLOYEE_CSV_COLUMNS) {
      expect(Object.values(FIELD_BY_LABEL)).toContain(column.key);
    }
  });
});

describe("csv formula guard on export", () => {
  it("neutralises a bare formula prefix", () => {
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("+1")).toBe("'+1");
    expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvValue("-cmd")).toBe("'-cmd");
  });

  it("neutralises a formula that also needs quoting, and stays valid CSV", () => {
    // The guard is applied before quoting, so the apostrophe survives the escape.
    expect(escapeCsvValue('=HYPERLINK("http://evil","x")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""x"")"'
    );
    expect(splitCsvLine(escapeCsvValue("=1+1"))).toEqual(["'=1+1"]);
  });

  it("leaves a leading minus in a numeric column alone", () => {
    expect(escapeCsvValue(-500)).toBe("-500");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCsvValue("Ali Raza")).toBe("Ali Raza");
  });
});