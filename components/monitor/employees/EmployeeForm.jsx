"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, Mail, ShieldCheck, UserPlus, X } from "lucide-react";

import { api, ApiError } from "@/lib/monitor/client";
import { Card } from "@/components/monitor/primitives";
import { Field, inputClass } from "@/components/monitor/config/fields";
import {
  employeeFormSchema,
  fieldErrors,
  normalizeCnic,
} from "@/lib/monitor/validation";
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
  geofencing_enabled: false,
  geofence_ids: [],
  attendance_source: "GPS APP",
  photo_url: "",
  tracking_consent: false,
};

const LOGIN_MODES = [
  {
    id: "invite",
    label: "Email a sign-in invite",
    hint: "Recommended. They choose their own password.",
  },
  {
    id: "password",
    label: "Create a temporary password",
    hint: "Use this when email is not available; share the password yourself.",
  },
  {
    id: "none",
    label: "No sign-in account yet",
    hint: "You can add one later from the employee row.",
  },
];

/**
 * Employee add/edit form (spec 5).
 *
 * The same component serves create and edit; `fromEmployeeRow` maps the DB row
 * back into form values, including the shift minutes-to-HH:MM conversion.
 *
 * Creating an employee also creates their sign-in account in the same action,
 * because the tracker app authenticates with Supabase email/password. The
 * invite is sent when a mailer is configured, otherwise the one-time link is
 * shown for the admin to share.
 */
export function EmployeeForm({ employee, departments, designations, geofences, onCancel, onSaved }) {
  const isEdit = Boolean(employee.id);
  const [values, setValues] = useState(() =>
    isEdit ? fromEmployeeRow(employee, { geofenceIds: employee.geofence_ids || [] }) : BLANK
  );
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loginMode, setLoginMode] = useState(isEdit ? "none" : "invite");
  const summaryRef = useRef(null);

  const set = (key) => (e) => {
    const value = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
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

  const fieldErrorEntries = Object.entries(errors).filter(
    ([key, message]) => key !== "_form" && Boolean(message)
  );
  const hasErrors = fieldErrorEntries.length > 0 || Boolean(errors._form);

  function showErrors(next) {
    setErrors(next);
    // The submit button sits at the bottom of a long form; without this the
    // first error can be far out of view and the save looks like it did nothing.
    setTimeout(() => {
      const node = summaryRef.current;
      if (!node) return;
      try {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        // jsdom and older browsers do not implement scrollIntoView.
      }
      try {
        node.focus({ preventScroll: true });
      } catch {
        // Ignore focus failures; the summary is still announced via role=alert.
      }
    }, 0);
  }

  function toggleFence(id) {
    setValues((v) => ({
      ...v,
      geofence_ids: v.geofence_ids.includes(id)
        ? v.geofence_ids.filter((g) => g !== id)
        : [...v.geofence_ids, id],
    }));
    setErrors((prev) => (prev.geofence_ids ? { ...prev, geofence_ids: undefined } : prev));
  }

  function validate() {
    const next = {};

    if (!isEdit && loginMode !== "none" && !String(values.email || "").trim()) {
      next.email =
        "Add an email for the sign-in account, or choose “No sign-in account yet”.";
    }

    const payload = {
      ...values,
      basic_salary: values.basic_salary === "" ? 0 : Number(values.basic_salary),
      geofence_ids: values.geofencing_enabled ? values.geofence_ids : [],
    };

    const parsed = employeeFormSchema.safeParse(payload);
    if (!parsed.success) Object.assign(next, fieldErrors(parsed.error));

    return {
      errors: next,
      data: parsed.success ? parsed.data : null,
    };
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setResult(null);

    const { errors: nextErrors, data } = validate();
    if (Object.keys(nextErrors).length || !data) {
      showErrors(nextErrors);
      setBusy(false);
      return;
    }

    try {
      if (isEdit) {
        await api.patch(`/api/monitor/employees/${employee.id}`, data);
        onSaved(`${data.name} was updated.`);
        return;
      }

      const created = await api.post("/api/monitor/employees", data);
      const employeeRow = created?.employee;

      let login = null;
      let loginError = null;

      if (loginMode !== "none" && employeeRow?.id) {
        try {
          login = await api.post("/api/employees", {
            mode: loginMode,
            employee_id: employeeRow.id,
            full_name: data.name,
            email: data.email,
            phone: data.contact_no,
          });
        } catch (err) {
          loginError = err.message || "Could not create the sign-in account.";
        }
      }

      if (loginError) {
        // The HR record is safely saved. Do not pretend the whole thing failed;
        // surface the half that did and let the admin retry from the row.
        setResult({ employee: employeeRow, loginError });
      } else if (login?.temporary_password) {
        setResult({ employee: employeeRow, temporaryPassword: login.temporary_password });
      } else if (login && login.emailed === false && login.invite_link) {
        setResult({
          employee: employeeRow,
          inviteLink: login.invite_link,
          emailError: login.email_error,
        });
      } else if (login?.emailed) {
        onSaved(`${data.name} was added. Invite emailed to ${data.email}.`);
      } else {
        onSaved(`${data.name} was added.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) showErrors(err.fields);
      else showErrors({ _form: err.message || "Could not save this employee" });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const person = result.employee || {};
    const name = person.name || values.name;
    const empCode = person.emp_code || values.emp_code;
    const secret = result.temporaryPassword || result.inviteLink;

    const finish = () => {
      if (result.loginError) {
        onSaved(
          `${name} was added, but the sign-in account could not be created. Add one from the employee row.`
        );
      } else if (result.temporaryPassword) {
        onSaved(`${name} was added with a temporary password.`);
      } else {
        onSaved(`${name} was added.`);
      }
    };

    return (
      <Card
        title="Employee added"
        subtitle={
          secret
            ? "Copy the access details now — they cannot be shown again."
            : "The directory and sign-in account are ready."
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] text-ink">
            {name} ({empCode}) was added to the directory.
          </p>

          {result.inviteLink ? (
            <SecretBox
              label="Invite link"
              value={result.inviteLink}
              hint="Send this one-time link to the employee so they can choose a password."
            />
          ) : null}

          {result.temporaryPassword ? (
            <SecretBox
              label="Temporary password"
              value={result.temporaryPassword}
              hint="Share this with the employee; they can change it after signing in."
            />
          ) : null}

          {result.emailError ? (
            <p className="rounded-tile border border-high/40 bg-high-tint px-3 py-2 text-[12px] text-high">
              The invite email was not sent ({result.emailError}). Share the link above instead.
            </p>
          ) : null}

          {result.loginError ? (
            <div
              role="alert"
              className="rounded-tile border border-crit/40 bg-crit-tint px-3 py-2 text-[12.5px] text-crit"
            >
              {result.loginError} The employee record was saved; use the “Sign-in account”
              action on their row to retry.
            </div>
          ) : null}

          {secret ? (
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
              />
              I have saved these details
            </label>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={Boolean(secret) && !acknowledged}
              onClick={finish}
              className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
            >
              {secret && !acknowledged ? "Confirm you have saved them" : "Done"}
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
          : "Personal details, job, shift, pay and sign-in access."
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {hasErrors ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="rounded-tile border border-crit/40 bg-crit-tint p-3 text-[12.5px] text-crit outline-none"
          >
            <p className="font-semibold">Could not save this employee</p>
            {errors._form ? <p className="mt-1">{errors._form}</p> : null}
            {fieldErrorEntries.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {fieldErrorEntries.map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

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
            <Field label="CNIC" required error={errors.cnic} hint="Format: 00000-0000000-0">
              <input
                value={values.cnic}
                onChange={set("cnic")}
                onBlur={(e) => {
                  const normalized = normalizeCnic(e.target.value);
                  if (normalized !== values.cnic) {
                    setValues((v) => ({ ...v, cnic: normalized }));
                  }
                }}
                required
                placeholder="35202-1234567-1"
                aria-invalid={Boolean(errors.cnic)}
                className={cn(inputClass(Boolean(errors.cnic)), "font-mono")}
              />
            </Field>
            <Field label="Contact no" error={errors.contact_no} hint="Format: 03XX-XXXXXXX">
              <input
                value={values.contact_no}
                onChange={set("contact_no")}
                placeholder="0300-1234567"
                aria-invalid={Boolean(errors.contact_no)}
                className={cn(inputClass(Boolean(errors.contact_no)), "font-mono")}
              />
            </Field>
            <Field label="Email" error={errors.email} hint="Required when you create a sign-in account">
              <input
                value={values.email}
                onChange={set("email")}
                type="email"
                aria-invalid={Boolean(errors.email)}
                className={inputClass(Boolean(errors.email))}
              />
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
                    No locations defined yet. Create one under Geo Zones first.
                  </p>
                )}
                {errors.geofence_ids ? (
                  <p role="alert" className="mt-1.5 text-[11.5px] font-medium text-crit">
                    {errors.geofence_ids}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </fieldset>

        {!isEdit ? (
          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-label font-semibold uppercase text-ink-dim">
              <UserPlus size={13} />
              Sign-in access
            </legend>
            <div className="rounded-tile border border-line bg-surface-2/50 p-3">
              <p className="text-[11.5px] text-ink-dim">
                The tracker app signs in with an email and password. Creating the account here
                saves a second trip to the employee row.
              </p>

              <div className="mt-3 grid gap-2">
                {LOGIN_MODES.map((mode) => (
                  <label
                    key={mode.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] transition",
                      loginMode === mode.id
                        ? "border-brand bg-brand-tint"
                        : "border-line bg-surface hover:border-brand/40"
                    )}
                  >
                    <input
                      type="radio"
                      name="login-mode"
                      value={mode.id}
                      checked={loginMode === mode.id}
                      onChange={() => setLoginMode(mode.id)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                    />
                    <span>
                      <span className="block font-semibold text-ink">{mode.label}</span>
                      <span className="block text-[11.5px] text-ink-dim">{mode.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {loginMode !== "none" ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-dim">
                  <Mail size={12} className="mt-0.5 shrink-0" />
                  <span>
                    Sends to{" "}
                    <span className="font-mono text-ink">{values.email || "the email above"}</span>.
                    If automatic email is not configured, the one-time invite link is shown for
                    you to copy.
                  </span>
                </p>
              ) : null}

              {errors.email ? (
                <p role="alert" className="mt-2 text-[11.5px] font-medium text-crit">
                  {errors.email}
                </p>
              ) : null}
            </div>
          </fieldset>
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

function SecretBox({ label, value, hint }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the value stays selectable in the box.
    }
  }

  return (
    <div className="rounded-tile border border-high/40 bg-high-tint p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-high">{label}</p>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-pill border border-high/40 bg-surface px-2 py-1 text-[11px] font-semibold text-high transition hover:bg-surface-2"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1.5 select-all break-all font-mono text-[12px] text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-ink-dim">{hint}</p> : null}
    </div>
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
