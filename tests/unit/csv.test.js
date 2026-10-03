import { describe, it, expect } from "vitest";
import { escapeCsvValue, toCsv, csvFilename, CSV_HEADERS, csvResponse } from "@/lib/monitor/csv";

describe("escapeCsvValue", () => {
  it("leaves plain text alone", () => {
    expect(escapeCsvValue("Ali Raza")).toBe("Ali Raza");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvValue("Ali, Raza")).toBe('"Ali, Raza"');
  });

  it("quotes a value containing a double quote", () => {
    expect(escapeCsvValue('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null and undefined as empty", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("keeps numbers machine-readable", () => {
    expect(escapeCsvValue(0)).toBe("0");
    expect(escapeCsvValue(-5)).toBe("-5");
    expect(escapeCsvValue(1234.5)).toBe("1234.5");
  });

  it("preserves a literal boolean", () => {
    expect(escapeCsvValue(false)).toBe("false");
  });

  it("neutralises formula injection", () => {
    // A cell starting with = must not execute in Excel/Sheets.
    const out = escapeCsvValue("=1+1");
    expect(out).toBe("'=1+1");
  });

  it("neutralises leading +, - and @", () => {
    expect(escapeCsvValue("+cmd")).toBe("'+cmd");
    expect(escapeCsvValue("-cmd")).toBe("'-cmd");
    expect(escapeCsvValue("@cmd")).toBe("'@cmd");
  });

  it("still quotes a formula that also contains a comma", () => {
    expect(escapeCsvValue('=HYPERLINK("a","b")')).toBe('"\'=HYPERLINK(""a"",""b"")"');
  });

  it("does not mangle text that merely contains an equals sign", () => {
    expect(escapeCsvValue("Ali = Raza")).toBe("Ali = Raza");
  });
});

describe("toCsv", () => {
  const columns = [
    { key: "emp_code", label: "Code" },
    { key: "name", label: "Name" },
  ];
  const rows = [
    { emp_code: "EMP-001", name: "Ali Raza" },
    { emp_code: "EMP-002", name: "Bilal, Khan" },
  ];

  it("writes a header row from the column labels", () => {
    expect(toCsv(rows, columns, { bom: false })).toBe(
      'Code,Name\r\nEMP-001,Ali Raza\r\nEMP-002,"Bilal, Khan"'
    );
  });

  it("uses CRLF line endings per RFC 4180", () => {
    expect(toCsv(rows, columns, { bom: false })).toContain("\r\n");
  });

  it("prepends a BOM by default so Excel reads UTF-8", () => {
    expect(toCsv(rows, columns).charCodeAt(0)).toBe(0xfeff);
  });

  it("omits the BOM when asked", () => {
    expect(toCsv(rows, columns, { bom: false }).charCodeAt(0)).not.toBe(0xfeff);
  });

  it("writes headers only for an empty dataset", () => {
    expect(toCsv([], columns, { bom: false })).toBe("Code,Name");
  });

  it("leaves gaps for missing keys", () => {
    expect(toCsv([{ emp_code: "EMP-001" }], columns, { bom: false })).toBe("Code,Name\r\nEMP-001,");
  });

  it("applies a column format function", () => {
    const out = toCsv(
      [{ name: "ali" }],
      [{ key: "name", label: "Name", format: (v) => String(v).toUpperCase() }],
      { bom: false }
    );
    expect(out).toBe("Name\r\nALI");
  });

  it("passes the whole row to the format function", () => {
    const out = toCsv(
      [{ first: "Ali", last: "Raza" }],
      [{ key: "name", label: "Name", format: (_v, row) => `${row.first} ${row.last}` }],
      { bom: false }
    );
    expect(out).toBe("Name\r\nAli Raza");
  });

  it("neutralises a malicious employee name in the body", () => {
    const out = toCsv([{ name: "=cmd|'/c calc'!A0" }], [{ key: "name", label: "Name" }], { bom: false });
    expect(out).not.toContain("\r\n=cmd");
  });
});

describe("csvFilename", () => {
  it("builds a dated filename", () => {
    expect(csvFilename("attendance", "2026-10-03")).toBe("attendance-2026-10-03.csv");
  });

  it("works without a date", () => {
    expect(csvFilename("attendance")).toBe("attendance.csv");
  });

  it("replaces unsafe characters", () => {
    expect(csvFilename("device & data alerts", "2026-10-03")).toBe("device-data-alerts-2026-10-03.csv");
  });
});

describe("csvResponse", () => {
  it("returns a downloadable CSV response", () => {
    const res = csvResponse([{ a: 1 }], [{ key: "a", label: "A" }], "report", "2026-10-03");
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("report-2026-10-03.csv");
  });

  it("does not cache the export", () => {
    const res = csvResponse([], [], "report", "2026-10-03");
    expect(res.headers.get("Cache-Control")).toBe(CSV_HEADERS["Cache-Control"]);
  });
});