"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload, X } from "lucide-react";

import { Card } from "@/components/monitor/primitives";
import { api } from "@/lib/monitor/client";
import { cn } from "@/lib/utils";

/**
 * CSV import with a per-row report.
 *
 * Imported rows come back with a generated app password. This is the only place
 * it is ever visible, so it is shown once with a clear warning to copy it down
 * before closing.
 */
export function ImportReport({ onClose, onImported }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function upload(file) {
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const data = await api.upload("/api/monitor/employees/import", form);
      setResult(data);
      setAcknowledged(data.imported === 0);
      onImported();
    } catch (err) {
      setError(err.message || "Could not import this file");
      // A rejected import still carries its per-row report.
      if (Array.isArray(err.payload?.errors)) {
        setResult({ imported: 0, failed: err.payload.errors.length, credentials: [], errors: err.payload.errors });
      }
    } finally {
      setBusy(false);
    }
  }

  const errors = result?.errors || [];
  const credentials = result?.credentials || [];

  return (
    <Card
      title="Import employees from CSV"
      subtitle="Download the export of your current employees to get the exact column layout, then fill it in."
      action={
        <div className="flex gap-2">
          <a
            href="/api/monitor/employees/export?include_archived=1"
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <Download size={13} />
            Template
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files?.[0]);
          }}
          className="rounded-tile border border-dashed border-line bg-surface-2/40 px-4 py-6 text-center"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => upload(e.target.files?.[0])}
            className="sr-only"
            id="employee-csv-input"
          />
          <label
            htmlFor="employee-csv-input"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong"
          >
            <Upload size={14} />
            Choose a CSV file
          </label>
          <p className="mt-2 text-[12px] text-ink-dim">
            {busy ? "Importing…" : fileName || "or drop one here. Up to 500 rows."}
          </p>
        </div>

        {error ? (
          <p role="alert" className="flex items-center gap-1.5 text-[12.5px] font-medium text-crit">
            <AlertTriangle size={14} />
            {error}
          </p>
        ) : null}

        {result ? (
          <>
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 rounded-pill bg-ok-tint px-2.5 py-1 font-semibold text-ok">
                <CheckCircle2 size={13} />
                {result.imported} imported
              </span>
              {result.failed ? (
                <span className="flex items-center gap-1.5 rounded-pill bg-crit-tint px-2.5 py-1 font-semibold text-crit">
                  <AlertTriangle size={13} />
                  {result.failed} failed
                </span>
              ) : null}
            </div>

            {credentials.length ? (
              <div className="rounded-tile border border-high/40 bg-high-tint p-3">
                <p className="text-[12.5px] font-semibold text-high">
                  Copy these app passwords now — they are not shown again.
                </p>
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-ink-dim">
                        <th className="py-1 pr-3">Employee ID</th>
                        <th className="py-1 pr-3">Name</th>
                        <th className="py-1">App password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credentials.map((c) => (
                        <tr key={c.emp_code} className="border-t border-line/60">
                          <td className="py-1 pr-3 font-mono text-ink">{c.emp_code}</td>
                          <td className="py-1 pr-3 text-ink">{c.name}</td>
                          <td className="py-1 font-mono font-semibold text-ink">{c.appPassword}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                  />
                  I have saved these passwords
                </label>
              </div>
            ) : null}

            {errors.length ? (
              <div className="rounded-tile border border-crit/40 bg-crit-tint p-3">
                <p className="text-[12.5px] font-semibold text-crit">
                  {errors.length} problem{errors.length === 1 ? "" : "s"} to fix
                </p>
                <ul className="mt-1.5 space-y-1">
                  {errors.map((e, i) => (
                    <li key={`${e.line}-${i}`} className="text-[12px] text-ink">
                      <span className="font-mono text-ink-dim">
                        {e.line ? `line ${e.line}` : ""}
                      </span>
                      {e.label ? <span className="font-medium"> {e.label}: </span> : null}
                      {e.message || (e.issues || []).map((x) => `${x.field} ${x.message}`).join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={credentials.length > 0 && !acknowledged}
            className={cn(
              "rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong",
              credentials.length > 0 && !acknowledged ? "opacity-50" : ""
            )}
          >
            {credentials.length > 0 && !acknowledged
              ? "Confirm the passwords first"
              : "Done"}
          </button>
        </div>
      </div>
    </Card>
  );
}