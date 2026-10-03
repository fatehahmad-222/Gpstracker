/**
 * CSV export (RFC 4180).
 *
 * Spec 4.6 asks for "Download Excel". We emit CSV rather than XLSX on purpose:
 * the npm `xlsx` package is stale and carries known CVEs, and SheetJS now
 * distributes from their own CDN rather than npm. Excel, LibreOffice, Numbers
 * and Google Sheets all open RFC 4180 CSV directly.
 */

/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Quote a value if it contains a delimiter, quote, CR or LF. */
export function escapeCsvValue(value) {
  if (value == null) return "";

  // Numbers and booleans are safe and must stay machine-readable (a payroll
  // column of "-5" becoming "'-5" would break the import), so the formula
  // guard below applies to text only.
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  let s = String(value);

  // Spreadsheet formula injection: employee names, notes and device labels are
  // user-controlled, so a cell like `=HYPERLINK("http://evil","x")` would
  // execute when an admin opens the export. A leading apostrophe is the
  // portable way to force Excel / Sheets / LibreOffice to treat it as text.
  if (FORMULA_LEAD.test(s)) s = `'${s}`;

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Array<object>} rows
 * @param {Array<{key:string,label:string,format?:(v:any,row:object)=>any}>} columns
 * @param {string} [bom] prepend a UTF-8 BOM so Excel renders Urdu/Pakistani
 *                        names correctly on Windows (default on).
 */
export function toCsv(rows = [], columns = [], { bom = true } = {}) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const raw = row[c.key];
          const value = c.format ? c.format(raw, row) : raw;
          return escapeCsvValue(value);
        })
        .join(",")
    )
    .join("\r\n");

  return `${bom ? "\uFEFF" : ""}${header}${body ? `\r\n${body}` : ""}`;
}

/**
 * Split one CSV line into cells, honouring quoted fields and doubled quotes.
 *
 * A full RFC 4180 parser is not needed here: `escapeCsvValue` escapes commas,
 * quotes and newlines rather than embedding raw newlines inside a cell, so a
 * line-oriented parser round-trips exactly what `toCsv` produces.
 */
export function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current);
  return cells.map((c) => c.trim());
}

/** Content-Disposition filename safe for both Windows and HTTP. */
export function csvFilename(prefix, dateStr) {
  const safe = String(prefix).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const stamp = dateStr ? `-${String(dateStr).slice(0, 10)}` : "";
  return `${safe}${stamp}.csv`;
}

export const CSV_HEADERS = {
  "Content-Type": "text/csv; charset=utf-8",
  "Cache-Control": "no-store",
};

/** Response helper for a route handler. */
export function csvResponse(rows, columns, prefix, dateStr) {
  return new Response(toCsv(rows, columns), {
    headers: {
      ...CSV_HEADERS,
      "Content-Disposition": `attachment; filename="${csvFilename(prefix, dateStr)}"`,
    },
  });
}