import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse } from "@/lib/server/api";
import { csvResponse } from "@/lib/monitor/csv";
import { toCompanyDate } from "@/lib/monitor/datetime";
import { EMPLOYEE_CSV_COLUMNS } from "@/lib/monitor/csv-columns";
import { listEmployees, withEmployeeLabels, midnightToTime } from "@/lib/server/employees";

export const dynamic = "force-dynamic";

/** "yes"/"no" so the export round-trips through the importer's boolean parser. */
const yesNo = (value) => (value ? "yes" : "no");

/**
 * GET /api/monitor/employees/export
 *
 * Server-side so the export respects the caller's company and filters without
 * paging the whole table into the browser. The filters match the list screen.
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const { rows } = await listEmployees(ctx.supabase, {
      companyId: ctx.companyId,
      departmentId: searchParams.get("department_id") || null,
      designationId: searchParams.get("designation_id") || null,
      status: searchParams.get("status") || null,
      geofencing: searchParams.get("geofencing") || null,
      search: searchParams.get("q") || null,
      includeArchived: searchParams.get("include_archived") === "1",
      // An export is not a screen: it returns everything that matched, and the
      // cap stops one request from pulling an unbounded table.
      from: 0,
      to: 9999,
    });

    const labelled = await withEmployeeLabels(ctx.supabase, {
      companyId: ctx.companyId,
      rows,
    });

    const body = labelled.map((row) => ({
      ...row,
      contact_no: row.phone,
      department: row.department_name ?? "",
      designation: row.designation_name ?? "",
      // Converted back to HH:MM so the file matches what the import expects.
      shift_start: midnightToTime(row.shift_start),
      shift_end: midnightToTime(row.shift_end),
      geofencing_enabled: yesNo(row.geofencing_enabled),
    }));

    return csvResponse(body, EMPLOYEE_CSV_COLUMNS, "employees", toCompanyDate(new Date()));
  } catch (error) {
    return dbErrorResponse(error, "Could not export employees");
  }
}