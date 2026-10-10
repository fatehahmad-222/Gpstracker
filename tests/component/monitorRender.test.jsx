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
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AlertManager } from "@/components/monitor/alerts/AlertManager";
import { AttendanceLogs } from "@/components/monitor/attendance/AttendanceLogs";
import { AttendanceManager } from "@/components/monitor/attendance/AttendanceManager";
import { Dashboard } from "@/components/monitor/dashboard/Dashboard";
import { DeviceManager } from "@/components/monitor/devices/DeviceManager";
import { EmployeeManager } from "@/components/monitor/employees/EmployeeManager";
import { FenceManager } from "@/components/monitor/geofencing/FenceManager";
import { LeaveManager } from "@/components/monitor/leaves/LeaveManager";
import { LiveMapScreen } from "@/components/monitor/map/LiveMapScreen";
import { PolicyManager } from "@/components/monitor/config/PolicyManager";
import { TaskManager } from "@/components/monitor/tasks/TaskManager";
import { NavList } from "@/components/dashboard/AdminShell";
import { NAV } from "@/lib/dashboard/nav";
import { TaskHistory } from "@/components/monitor/tasks/TaskHistory";

const get = vi.fn(async () => ({ rows: [] }));

vi.mock("@/lib/monitor/client", () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  // Real behaviour, not a stub: several screens put a meaningful `kind` in the
  // query string, and dropping it here would hide exactly the class of bug below.
  qs: (params = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === "") continue;
      search.set(key, String(value));
    }
    const str = search.toString();
    return str ? `?${str}` : "";
  },
  ApiError: class ApiError extends Error {},
}));

// next/link wants the App Router runtime, which does not exist here. The nav
// only uses href and aria-current, so a plain anchor is behaviourally identical
// for what these tests assert.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The geofencing screen lazy-loads its Leaflet map via next/dynamic. jsdom has
// no reason to drag Leaflet (and its window assumptions) into this suite, and the
// screen only needs the wrapper to resolve to something renderable.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// Both of these reach for the Next router, which does not exist outside the App
// Router runtime. The screens only use them to read and write URL state.
//
// The real hook returns an object (`{ values, params, setParam, ... }`), which is
// how every consumer destructures it — an array-shaped stub silently fed
// `undefined` into `filters`, so mounts failed before reaching the code under
// test. Mirror the real shape.
vi.mock("@/hooks/monitor/useQueryState", () => ({
  useQueryState: (defaults = {}) => ({
    values: { ...defaults },
    params: new URLSearchParams(),
    setParam: vi.fn(),
    setMany: vi.fn(),
    reset: vi.fn(),
    toggle: vi.fn(),
  }),
}));
vi.mock("@/hooks/monitor/usePolling", () => ({
  // Mirror the real return shape (`{ isRefreshing, lastUpdated, refresh }`).
  // LiveMapScreen is the only consumer and destructures it, so a bare vi.fn()
  // returning undefined would crash the mount before the code under test runs.
  usePolling: () => ({ isRefreshing: false, lastUpdated: null, refresh: vi.fn() }),
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
  // Reset, not just clear: a test may install its own implementation, and a
  // lingering one would leak into every later test in the file.
  get.mockReset();
  get.mockImplementation(async () => ({ rows: [] }));
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
  ["FenceManager", <FenceManager key="fences" />],
  ["LeaveManager", <LeaveManager key="leaves" />],
  ["LiveMapScreen", <LiveMapScreen key="live-map" />],
  ["TaskManager", <TaskManager key="tasks" />],
  ["PolicyManager", <PolicyManager key="policies" />],
  ["TaskHistory", <TaskHistory key="task-history" />],
  ["NavList", <NavList key="nav" pathname="/dashboard" />],
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

/**
 * The generic mount test cannot see render-phase throws (React reports them
 * asynchronously), so it happily passed a FenceManager whose action column had
 * `header: ""` and no `id` — TanStack then threw "Columns require an id when
 * using a non-string header" while building the table. Asserting that nothing is
 * logged is what makes that failure mode observable.
 */
describe("FenceManager builds its table columns", () => {
  it("mounts without a TanStack column-id error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<FenceManager />);
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith(expect.stringContaining("/api/monitor/geofences"))
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * Regression: Live Map replaced its whole map with the generic "Could not load
 * this data" error state, because it asked the org-units route for
 * `kind=department` (singular). The route only knows the plural keys
 * ("departments", "sub_departments", "designations") and answers any other kind
 * with a 400, which the screen treated as fatal. The URL is the contract here,
 * so it is asserted directly. (LiveMapScreen was also absent from SCREENS, which
 * is how it shipped — see the mount list above.)
 */
describe("LiveMapScreen loads its department filter", () => {
  it("asks org-units for the plural `departments` key the route accepts", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<LiveMapScreen />);
      await waitFor(() =>
        expect(get.mock.calls.some(([url]) => url?.includes("/api/monitor/org-units"))).toBe(true)
      );
      const orgUnitCall = get.mock.calls
        .map(([url]) => url)
        .find((url) => url?.includes("/api/monitor/org-units"));
      expect(orgUnitCall).toContain("kind=departments");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * The mount smoke test above only reaches Task History's empty state, because
 * the shared API stub returns no rows. That is exactly the shape that let two
 * runtime breaks ship: the status sort read an undefined `STATUS_ORDER`, and the
 * timestamp formatter was imported from a module that does not export it. Both
 * only execute once a task row is present, so this test supplies one.
 */
describe("Task History renders real task rows", () => {
  it("sorts and formats a completed task without throwing", async () => {
    get.mockImplementation(async (url) => {
      if (url.includes("/api/monitor/employees")) {
        return {
          rows: [
            { id: "emp1", name: "Ada", emp_code: "E1", profile_id: "p1", status: "active", deleted_at: null },
          ],
        };
      }
      if (url.includes("/api/monitor/tasks")) {
        return {
          rows: [
            {
              id: "t1",
              title: "Spot check",
              status: "completed",
              completion_source: "geofence",
              target_lat: 24.86,
              target_lng: 67.01,
              target_address: "Clifton",
              radius_meters: 100,
              created_at: "2026-10-01T10:00:00.000Z",
              due_at: null,
              completed_at: "2026-10-01T12:00:00.000Z",
            },
            {
              id: "t2",
              title: "Open call",
              status: "pending",
              completion_source: null,
              target_lat: null,
              target_lng: null,
              target_address: null,
              radius_meters: 100,
              created_at: "2026-10-02T10:00:00.000Z",
              due_at: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<TaskHistory />);
      expect(await screen.findByText("Spot check")).toBeTruthy();
      expect(screen.getByText("Open call")).toBeTruthy();
      await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("/api/monitor/tasks")));
      expect(spy).not.toHaveBeenCalled();
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
});

/**
 * The console sidebar replaced the old monitor sidebar, which owned its own glyph
 * table keyed by icon *name*. The new nav imports lucide components directly, so
 * the failure this guards against is a nav entry rendered without a usable icon.
 */
describe("the merged console nav", () => {
  it("renders every top-level section", () => {
    render(<NavList pathname="/dashboard" />);
    for (const item of NAV) {
      expect(screen.getAllByText(item.label).length).toBeGreaterThan(0);
    }
  });

  it("auto-expands the group that owns the current route", () => {
    // A deep link must not land with its section collapsed, or the user cannot
    // see which tab they are on.
    render(<NavList pathname="/dashboard/attendance/logs" />);
    expect(screen.getByText("Records")).toBeTruthy();
  });

  it("marks the current route with aria-current", () => {
    render(<NavList pathname="/dashboard/tasks" />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.length).toBeGreaterThan(0);
    expect(current[0].getAttribute("href")).toBe("/dashboard/tasks");
  });

  it("links nothing back to the removed /monitor product", () => {
    render(<NavList pathname="/dashboard/configuration/departments" />);
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href")).not.toMatch(/^\/monitor/);
    }
  });

  it("includes the Task History top-level tab", () => {
    render(<NavList pathname="/dashboard/task-history" />);
    const links = screen.getAllByRole("link");
    const hasTaskHistory = links.some((a) => a.getAttribute("href") === "/dashboard/task-history");
    expect(hasTaskHistory).toBe(true);
  });
});