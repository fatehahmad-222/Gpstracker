"use client";

import { useMemo, useState } from "react";
import { X, ShieldCheck, KeyRound } from "lucide-react";

import { api, ApiError } from "@/lib/monitor/client";
import { Card } from "@/components/monitor/primitives";
import { Field, inputClass } from "@/components/monitor/config/fields";
import { passwordChecklist } from "@/lib/monitor/validation";
import { fromEmployeeRow } from "@/lib/monitor/employee-mapper";
import { cn } from "@/lib/utils";

const BLANK = {
  emp_code: "",
  name: "",
  father_husband_name: "",
  dob: "",
  gender: "male",
  marital_status: "",
  cnic: "",
  contact_no: "",
  email: "",
  address: "",
  hire_date: "",
  education: "",
  department_id: "",
  designation_id: "",
  last_job_history: "",
  shift_start: "09:00",
  shift_end: "17:00",
  overnight_approved: false,
  basic_salary: "",
  payment_method: "",
  late_deduction: false,
  overtime_allowed: true,
  absent_deduction: false,
  wht_tax: false,
  geofencing_enabled: true,
  geofence_ids: [],
  attendance_source: "GPS APP",
  photo_url: "",
  tracking_consent: false,
};

/**
 * Employee add/edit form (spec 5).
 *
 * The same component serves create and edit; `fromEmployeeRow` maps the DB row
 * back into form values, including the shift minutes-to-HH:MM conversion.
 */
export function EmployeeForm({ employee, departments, designations, geofences, onCancel, onSaved }) {
  const isEdit = Boolean(employee.id);
  const [values, setValues] = useState(() =>
    isEdit ? fromEmployeeRow(employee, { geofenceIds: employee.geofence_ids || [] }) : BLANK
  );
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // Set after a create whose password was generated server-side.
  const [created, setCreated] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [generatePassword, setGeneratePassword] = useState(!isEdit);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  // Only designations belonging to the chosen department make sense.
  const relevantDesignations = useMemo(
    () =>
      designations.filter(
        (d) => !values.department_id || d.department_id === values.department_id
      ),
    [designations, values.department_id]
  );

  const checklist = useMemo(() => passwordChecklist(values.app_password || ""), [values.app_password]);

  function toggleFence(id) {
    setValues((v) => ({
      ...v,
      geofence_ids: v.geofence_ids.includes(id)
        ? v.geofence_ids.filter((g) => g !== id)
        : [...v.geofence_ids, id],
    }));
    setErrors((prev) => (prev.geofence_ids ? { ...prev, geofence_ids: undefined } : prev));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});

    // The password is optional: leaving it blank on an edit keeps the existing
    // one, and the reset dialog is the deliberate way to change it.
    const payload = {
      ...values,
      basic_salary: values.basic_salary === "" ? 0 : Number(values.basic_salary),
      app_password: values.app_password || undefined,
    };

    try {
      if (isEdit) {
        const body = { ...payload };
        delete body.app_password;
        await api.patch(`/api/monitor/employees/${employee.id}`, body);
        onSaved(`${values.name} was updated.`);
      } else {
        const data = await api.post("/api/monitor/employees", payload);
        // A generated password is only ever visible here, so hold the form open
        // until the admin has copied it.
        if (data?.generatedPassword) {
          setCreated({ empCode: values.emp_code, name: values.name, password: data.generatedPassword });
        } else {
          onSaved(`${values.name} was added.`);
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _form: err.message || "Could not save this employee" });
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Card title="Employee added" subtitle="Copy the app password now — it cannot be shown again.">
        <div className="space-y-4">
          <div className="rounded-tile border border-high/40 bg-high-tint p-3">
            <p className="text-[12.5px] font-semibold text-high">
              {created.name} ({created.empCode}) signs in to the tracker app with:
            </p>
            <p className="mt-1.5 select-all font-mono text-[16px] font-semibold tracking-wide text-ink">
              {created.password}
            </p>
            <p className="mt-2 text-[11.5px] text-ink-dim">
              It is stored as a hash. If it is lost it can only be reset, not recovered.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
            />
            I have saved this password
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!acknowledged}
              onClick={() => onSaved(`${created.name} was added.`)}
              className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
            >
              {acknowledged ? "Done" : "Confirm you have saved it"}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={isEdit ? `Edit ${employee.name}` : "Add an employee"}
      subtitle={
        isEdit
          ? "Changes apply from now on; past attendance and payroll are unaffected."
          : "Personal details, job, shift and pay. The tracker app password can be generated for you."
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-label font-semibold uppercase text-ink-dim">Personal</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" required error={errors.name}>
              <input value={values.name} onChange={set("name")} required className={inputClass(Boolean(errors.name))} />
            </Field>
            <Field label="Employee ID" required error={errors.emp_code}>
              <input
                value={values.emp_code}
                onChange={set("emp_code")}
                required
                placeholder="e.g. EMP-001"
                className={cn(inputClass(Boolean(errors.emp_code)), "font-mono")}
              />
            </Field>
            <Field label="Father / Husband name" error={errors.father_husband_name}>
              <input value={values.father_husband_name} onChange={set("father_husband_name")} className={inputClass()} />
            </Field>
            <Field label="CNIC" error={errors.cnic}>
              <input
                value={values.cnic}
                onChange={set("cnic")}
                placeholder="35202-1234567-1"
                className={cn(inputClass(Boolean(errors.cnic)), "font-mono")}
              />
            </Field>
            <Field label="Contact no" error={errors.contact_no}>
              <input
                value={values.contact_no}
                onChange={set("contact_no")}
                placeholder="0300-1234567"
                className={cn(inputClass(Boolean(errors.contact_no)), "font-mono")}
              />
            </Field>
            <Field label="Email" error={errors.email}>
              <input value={values.email} onChange={set("email")} type="email" className={inputClass(Boolean(errors.email))} />
            </Field>
            <Field label="Gender" required error={errors.gender}>
              <select value={values.gender} onChange={set("gender")} className={inputClass()}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Marital status" error={errors.marital_status}>
              <select value={values.marital_status} onChange={set("marital_status")} className={inputClass()}>
                <option value="">Not stated</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </Field>
            <Field label="Date of birth" error={errors.dob}>
              <input type="date" value={values.dob} onChange={set("dob")} className={inputClass(Boolean(errors.dob))} />
            </Field>
            <Field label="Education" error={errors.education}>
              <input value={values.education} onChange={set("education")} className={inputClass()} />
            </Field>
            <Field label="Address" error={errors.address} className="sm:col-span-2">
              <input value={values.address} onChange={set("address")} className={inputClass()} />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-label font-semibold uppercase text-ink-dim">Job</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Department" required error={errors.department_id}>
              <select value={values.department_id} onChange={set("department_id")} className={inputClass(Boolean(errors.department_id))}>
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Designation" required error={errors.designation_id}>
              <select value={values.designation_id} onChange={set("designation_id")} className={inputClass(Boolean(errors.designation_id))}>
                <option value="">Select a designation</option>
                {relevantDesignations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Hiring date" required error={errors.hire_date}>
              <input type="date" value={values.hire_date} onChange={set("hire_date")} className={inputClass(Boolean(errors.hire_date))} />
            </Field>
            <Field label="Last job history" error={errors.last_job_history}>
              <input value={values.last_job_history} onChange={set("last_job_history")} className={inputClass()} />
            </Field>
            <Field label="Attendance source" error={errors.attendance_source}>
              <select value={values.attendance_source} onChange={set("attendance_source")} className={inputClass()}>
                <option value="GPS APP">GPS APP</option>
                <option value="Manual">Manual</option>
                <option value="Web">Web</option>
              </select>
            </Field>
            <Field label="Shift start" required error={errors.shift_start}>
              <input type="time" value={values.shift_start} onChange={set("shift_start")} className={inputClass(Boolean(errors.shift_start))} />
            </Field>
            <Field
              label="Shift end"
              required
              error={errors.shift_end}
              hint={values.shift_end && values.shift_end <= values.shift_start ? "Overnight shift" : undefined}
            >
              <input type="time" value={values.shift_end} onChange={set("shift_end")} className={inputClass(Boolean(errors.shift_end))} />
            </Field>
            <Field label="Overnight approved" hint="Required for shifts past midnight">
              <label className="flex h-[38px] items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(values.overnight_approved)}
                  onChange={set("overnight_approved")}
                  className="h-4 w-4 accent-[rgb(var(--brand))]"
                />
                Approved
              </label>
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-label font-semibold uppercase text-ink-dim">Pay</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Basic salary (PKR)" required error={errors.basic_salary}>
              <input
                type="number"
                min="0"
                step="1"
                value={values.basic_salary}
                onChange={set("basic_salary")}
                className={inputClass(Boolean(errors.basic_salary))}
              />
            </Field>
            <Field label="Payment method" error={errors.payment_method}>
              <select value={values.payment_method} onChange={set("payment_method")} className={inputClass()}>
                <option value="">Not set</option>
                <option value="bank">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-1">
              <Toggle label="Late deduction" checked={values.late_deduction} onChange={set("late_deduction")} />
              <Toggle label="Overtime" checked={values.overtime_allowed} onChange={set("overtime_allowed")} />
              <Toggle label="Absent deduction" checked={values.absent_deduction} onChange={set("absent_deduction")} />
              <Toggle label="WHT tax" checked={values.wht_tax} onChange={set("wht_tax")} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 flex items-center gap-1.5 text-label font-semibold uppercase text-ink-dim">
            <ShieldCheck size={13} />
            Tracking &amp; access
          </legend>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <Toggle label="Geo-fencing" checked={values.geofencing_enabled} onChange={set("geofencing_enabled")} />
              <Toggle
                label="Tracking consent recorded"
                checked={values.tracking_consent}
                onChange={set("tracking_consent")}
              />
            </div>

            {values.geofencing_enabled ? (
              <div>
                <span className="mb-1.5 block text-[11.5px] font-semibold uppercase text-ink-dim">
                  Assigned locations
                </span>
                {geofences.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {geofences.map((fence) => {
                      const active = values.geofence_ids.includes(fence.id);
                      return (
                        <button
                          key={fence.id}
                          type="button"
                          onClick={() => toggleFence(fence.id)}
                          className={cn(
                            "rounded-pill border px-2.5 py-1 text-[11.5px] font-medium transition",
                            active
                              ? "border-brand bg-brand-tint text-brand"
                              : "border-line bg-surface text-ink-dim hover:border-brand/40"
                          )}
                          aria-pressed={active}
                        >
                          {fence.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-dim">
                    No locations defined yet. Create one under Geofencing first.
                  </p>
                )}
                {errors.geofence_ids ? (
                  <p role="alert" className="mt-1.5 text-[11.5px] font-medium text-crit">
                    {errors.geofence_ids}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!isEdit || generatePassword ? (
              <div className="rounded-tile border border-line bg-surface-2/50 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={generatePassword}
                    onChange={(e) => setGeneratePassword(e.target.checked)}
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                  />
                  <KeyRound size={13} />
                  Create a tracker app password
                </label>

                {generatePassword ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      value={values.app_password || ""}
                      onChange={set("app_password")}
                      placeholder="Leave blank to generate automatically"
                      className={cn(inputClass(Boolean(errors.app_password)), "font-mono")}
                    />
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 self-center">
                      {checklist.map((rule) => (
                        <li
                          key={rule.key}
                          className={cn("text-[11px]", rule.ok ? "text-ok" : "text-ink-dim")}
                        >
                          {rule.ok ? "✓" : "○"} {rule.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {errors.app_password ? (
                  <p role="alert" className="mt-1.5 text-[11.5px] font-medium text-crit">
                    {errors.app_password}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </fieldset>

        {errors._form ? (
          <p role="alert" className="text-[12px] font-medium text-crit">{errors._form}</p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add employee"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <X size={13} />
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[rgb(var(--brand))]"
      />
      {label}
    </label>
  );
}