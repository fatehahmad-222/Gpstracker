// @vitest-environment jsdom
/**
 * Component smoke tests.
 *
 * Until now no test in this project had ever mounted a React component. The unit
 * suite runs in Node against pure `lib/monitor/*` modules, the Playwright suite
 * only asserts that anonymous requests are refused or redirected, and `next build`
 * compiles without executing anything. That gap is how
 *
 *   ReferenceError: Cannot access 'debounced' before initialization
 *
 * shipped from components/monitor/attendance/AttendanceManager.jsx and took the
 * whole attendance screen down at runtime: `debounced` was declared *below* the
 * `useCallback` whose dependency array read it, and a dependency array is
 * evaluated during render while the const is still in its temporal dead zone.
 *
 * So the bar here is deliberately low and mechanical: every screen mounts, against
 * a stubbed API, without throwing. It is not asserting that the screens are
 * correct -- that is what the pure-logic unit tests and the E2E suite are for. This
 * file exists to answer the one question nothing else was answering, which is
 * "does this component render at all".
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { AlertManager } from "@/components/monitor/alerts/AlertManager";
import { AttendanceLogs } from "@/components/monitor/attendance/AttendanceLogs";
import { AttendanceManager } from "@/components/monitor/attendance/AttendanceManager";
import { Dashboard } from "@/components/monitor/dashboard/Dashboard";
import { DeviceManager } from "@/components/monitor/devices/DeviceManager";
import { EmployeeManager } from "@/components/monitor/employees/EmployeeManager";
import { LeaveManager } from "@/components/monitor/leaves/LeaveManager";
import { PolicyManager } from "@/components/monitor/config/PolicyManager";
import { MonitorSidebar } from "@/components/monitor/shell";
import { TaskManager } from "@/components/monitor/tasks/TaskManager";

const get = vi.fn(async () => ({ rows: [] }));

vi.mock("@/lib/monitor/client", () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  qs: () => "",
  ApiError: class ApiError extends Error {},
}));

// Both of these reach for the Next router, which does not exist outside the App
// Router runtime. The screens only use them to read and write URL state.
vi.mock("@/hooks/monitor/useQueryState", () => ({
  useQueryState: () => ["", vi.fn()],
}));
vi.mock("@/hooks/monitor/usePolling", () => ({
  usePolling: vi.fn(),
  useToday: () => "2026-01-01",
}));

beforeAll(() => {
  // @tanstack/react-table measures its container; jsdom provides neither of
  // these, and a missing ResizeObserver surfaces as an unrelated-looking crash.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  cleanup();
  get.mockClear();
});

/**
 * Every one of these takes no props and fetches its own data, so mounting them
 * with a stubbed API is enough to reach every hook, every memo and every state
 * initialiser in the tree.
 */
const SCREENS = [
  ["Dashboard", <Dashboard key="dashboard" />],
  ["AlertManager", <AlertManager key="alerts" />],
  ["AttendanceManager", <AttendanceManager key="attendance" />],
  ["AttendanceLogs", <AttendanceLogs key="attendance-logs" />],
  ["DeviceManager", <DeviceManager key="devices" />],
  ["EmployeeManager", <EmployeeManager key="employees" />],
  ["LeaveManager", <LeaveManager key="leaves" />],
  ["TaskManager", <TaskManager key="tasks" />],
  ["PolicyManager", <PolicyManager key="policies" />],
  ["MonitorSidebar", <MonitorSidebar key="sidebar" open pathname="/monitor" />],
];

describe("monitor components mount", () => {
  it.each(SCREENS)("%s renders without throwing", (_name, element) => {
    // React logs a caught render error and rethrows asynchronously, which would
    // otherwise surface as an unhandled rejection instead of a failed assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(element)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the regression this file was written for", () => {
  it("AttendanceManager does not read `debounced` before it is declared", () => {
    // Stated explicitly so that reintroducing the bug fails here with a message
    // that explains the failure mode, rather than only as a runtime crash.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<AttendanceManager />)).not.toThrow(/before initialization/);
    } finally {
      spy.mockRestore();
    }
  });

  it("the sidebar can read its glyph table", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<MonitorSidebar open pathname="/monitor" />)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});