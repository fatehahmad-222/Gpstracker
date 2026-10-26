export type Role = "employee" | "admin" | "viewer";

export type Bootstrap = {
  server_time: string;
  role: Role;
  company: { id: string; timezone: string };
  employee: {
    id: string;
    emp_code: string;
    name: string;
    phone: string | null;
    photo_url: string | null;
    shift_start: string | number | null;
    shift_end: string | number | null;
    department_id: string | null;
    designation_id: string | null;
  } | null;
  enrollment: {
    required: boolean;
    devices: Array<{
      id: string;
      device_id: string;
      label: string | null;
      created_at: string;
      last_used_at: string | null;
    }>;
    revoked_device: {
      id: string;
      device_id: string;
      revoked_at: string;
      can_reenroll: boolean;
    } | null;
  };
  tracking: {
    mode: string;
    interval_ms: number;
    distance_m: number;
    geofencing_enabled: boolean;
    consent: boolean;
    consent_at: string | null;
  };
  push: { registered: boolean; token_count: number };
  app: { min_version: string; latest_version: string | null; update_url: string | null };
  features: {
    tasks: boolean;
    attendance: boolean;
    leaves: boolean;
    push: boolean;
    device_signals: boolean;
  };
};

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type Task = {
  id: string;
  admin_id: string | null;
  employee_id: string;
  title: string;
  description: string | null;
  target_lat: number | null;
  target_lng: number | null;
  target_address: string | null;
  radius_meters: number | null;
  status: TaskStatus;
  completion_source: "manual" | "geofence" | null;
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
};

export type AttendanceLog = {
  id: string;
  employee_id: string;
  emp_code: string | null;
  name: string;
  department_name: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  geofence_id: string | null;
  out_reason?: string | null;
  source?: string | null;
  stay_seconds?: number;
  open?: boolean;
};

export type AttendanceOverview = {
  date: string;
  rows: Array<
    AttendanceLog & {
      shift_start: string | null;
      shift_end: string | null;
      status: string;
      punctuality: string | null;
      session_count: number;
      open_session_id: string | null;
      archived: boolean;
      worked_seconds?: number;
    }
  >;
  total: number;
  filtered: number;
  summary: Record<string, number>;
  chips: Array<{ key: string; label: string; count: number }>;
  departments: Array<{ id: string; name: string; present: number; total: number }>;
};

export type MyAttendance = {
  date: string;
  timezone: string;
  employee: { id: string; name: string; emp_code: string };
  rows: AttendanceLog[];
  open_session: {
    id: string;
    clock_in_at: string;
    out_reason: string | null;
    source: string | null;
  } | null;
  is_open: boolean;
};

export type Leave = {
  id: string;
  employee_id: string;
  leave_type: "casual" | "sick" | "annual";
  from_date: string;
  to_date: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  created_at: string;
  employee_name?: string | null;
  employee_code?: string | null;
};

export type Dashboard = {
  date: string;
  generated_at: string;
  summary: Record<string, number>;
  rate: { pct: number; present: number; denominator: number };
  kpis: Array<{
    key: string;
    label: string;
    value: number | string;
    suffix?: string;
    accent: string;
    hint: string;
  }>;
  tiles: unknown[];
  departments: Array<{ id: string; name: string; present: number; total: number }>;
  open_sessions: Array<{ employee_id: string; clock_in_at: string }>;
  command_center?: Array<{
    key: string;
    severity: string;
    label: string;
    count: number;
    rows: Array<{
      id: string;
      employee_id: string | null;
      label: string;
      severity: string;
      occurred_at: string;
    }>;
  }>;
  risk?: unknown[];
};

export type Position = {
  employee_id: string;
  emp_code: string | null;
  name: string;
  department_id: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
  recorded_at: string;
  age_ms: number | null;
  freshness: "live" | "stale" | "gone" | "never";
  archived: boolean;
  inside_fence: boolean | null;
  inside_fence_ids: string[];
  inside_fence_names: string[];
};

export type TeamMember = {
  id: string;
  emp_code: string;
  name: string;
  phone: string | null;
  email?: string | null;
  photo_url: string | null;
  profile_id?: string | null;
  status: string;
  department_id: string | null;
  department_name?: string | null;
  designation_name?: string | null;
  shift_start: string | number | null;
  shift_end: string | number | null;
  shift_label?: string;
  geofencing_enabled: boolean;
  tracking_consent: boolean;
  attendance_source?: string | null;
  hire_date?: string | null;
  created_at?: string;
};

export type AlertItem = {
  id: string;
  employee_id: string | null;
  emp_code: string | null;
  name: string;
  photo_url: string | null;
  department_name: string | null;
  type: string;
  label: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  occurred_at: string;
  status: "open" | "acknowledged" | "resolved";
  meta?: Record<string, unknown>;
};

export type AlertsResponse = {
  window_days: number;
  since: string;
  summary: {
    total: number;
    open: number;
    acknowledged: number;
    resolved: number;
    unresolved: number;
    critical: number;
    high: number;
    medium: number;
    by_category: Record<string, number>;
  };
  rows: AlertItem[];
  page: number;
  page_size: number;
};
