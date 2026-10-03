import { EMPLOYEE_CSV_COLUMNS, parseYesNo, canonicalHeader } from "./csv-columns";
import { splitCsvLine } from "./csv";

/**
 * Employee CSV import parsing.
 *
 * The export and the import must agree on the header row, so the column
 * definitions live in `csv-columns.js` and are shared: exporting writes
 * `EMPLOYEE_CSV_COLUMNS`, and importing accepts those same labels plus a few
 * friendly aliases for spreadsheets an admin edited by hand.
 */

/** Canonical CSV label -> `employees` form field name. */
const FIELD_BY_LABEL = Object.fromEntries(EMPLOYEE_CSV_COLUMNS.map((c) => [c.label, c.key]));

/**
 * Columns the CSV carries as a human name.
 *
 * These cannot be validated here: turning "Sales" into a uuid needs the
 * database, so the route resolves them before running the employee schema.
 */
export const NAME_FIELDS = new Set(["department", "designation"]);

/**
 * Parse uploaded CSV text into per-row payloads.
 *
 * This only does the shape work: map labels to field names, coerce the columns
 * that have a known type, and report which rows are structurally unusable.
 * Field-level validation runs in the route, after department/designation names
 * have been resolved to ids.
 *
 * Returns per-row results rather than throwing, so the UI can show a
 * spreadsheet-style report of which rows failed and why.
 */
export function parseEmployeeCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const allLines = clean.split(/\r?\n/);

  // Blank lines are skipped, but the reported line number stays tied to the
  // original file so an admin can find the row in their spreadsheet.
  const lines = allLines
    .map((text, index) => ({ text, lineNumber: index + 1 }))
    .filter((l) => l.text.trim() !== "");

  if (!lines.length) {
    return { rows: [], errors: [{ line: 0, label: "file", message: "The file is empty" }] };
  }

  const headers = splitCsvLine(lines[0].text).map(canonicalHeader);
  const known = new Set(EMPLOYEE_CSV_COLUMNS.map((c) => c.label));
  const unknown = headers.filter((h) => h && !known.has(h));

  if (!headers.some((h) => known.has(h))) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          label: "file",
          message: "No recognisable employee columns were found. Download the template and try again.",
        },
      ],
    };
  }

  const rows = [];
  const errors = [];

  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = lines[i].lineNumber;
    const cells = splitCsvLine(lines[i].text);
    const byLabel = {};

    headers.forEach((header, index) => {
      if (header) byLabel[header] = cells[index] ?? "";
    });

    // Identified before validation so any later report can name the row.
    const label = byLabel["Employee ID"] || byLabel.Name || `row ${lineNumber}`;
    const values = {};

    for (const [columnLabel, field] of Object.entries(FIELD_BY_LABEL)) {
      const value = byLabel[columnLabel];
      if (value === undefined) continue;
      values[field] = value;
    }

    // Typed up front because the sheet is hand-edited and unreliable.
    values.geofencing_enabled = parseYesNo(byLabel["Geo-Fencing"]) ?? false;
    if (values.gender) values.gender = String(values.gender).trim().toLowerCase();
    if (values.marital_status) {
      values.marital_status = String(values.marital_status).trim().toLowerCase();
    }
    if (values.status) values.status = String(values.status).trim().toLowerCase();

    // Without these two the row is unusable, and no later step can fix it.
    const issues = [];
    if (!values.name) issues.push({ field: "name", message: "Name is required" });
    if (!values.emp_code) issues.push({ field: "emp_code", message: "Employee ID is required" });

    if (issues.length) {
      errors.push({ line: lineNumber, label, issues });
      continue;
    }

    rows.push({ line: lineNumber, label, values });
  }

  if (unknown.length) {
    errors.unshift({
      line: 1,
      label: "header",
      message: `Ignored unrecognised columns: ${unknown.join(", ")}`,
    });
  }

  return { rows, errors };
}

export { EMPLOYEE_CSV_COLUMNS, parseYesNo, FIELD_BY_LABEL };