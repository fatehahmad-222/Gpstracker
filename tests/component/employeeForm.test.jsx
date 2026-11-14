// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/lib/monitor/client", () => ({
  api: {
    get: vi.fn(async () => ({ rows: [] })),
    post: (...args) => post(...args),
    patch: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  ApiError: class ApiError extends Error {
    constructor(message, { fields } = {}) {
      super(message);
      this.fields = fields;
    }
  },
  qs: () => "",
}));

import { EmployeeForm } from "@/components/monitor/employees/EmployeeForm";

const DEPT = "3f1a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8";
const DES = "2a1b1b2c-4d5e-6f70-8192-a3b4c5d6e7f8";

const BASE_PROPS = {
  employee: {},
  departments: [{ id: DEPT, name: "Operations" }],
  designations: [{ id: DES, name: "Driver", department_id: DEPT }],
  geofences: [],
  onCancel: vi.fn(),
  onSaved: vi.fn(),
};

function renderForm(overrides = {}) {
  return render(<EmployeeForm {...BASE_PROPS} {...overrides} />);
}

function changeField(label, value) {
  const labelNode = screen.getByText(label).closest("label");
  const control = labelNode?.querySelector("input, select");
  if (!control) throw new Error(`No control found for ${label}`);
  fireEvent.change(control, { target: { value } });
}

function fillRequiredFields() {
  changeField("Name", "Test Person");
  changeField("Employee ID", "EMP-100");
  changeField("CNIC", "35202-1234567-1");
  changeField("Contact no", "0300-1234567");
  changeField("Email", "test@example.com");
  changeField("Department", DEPT);
  changeField("Designation", DES);
  changeField("Hiring date", "2024-01-15");
  changeField("Basic salary (PKR)", "30000");
}

afterEach(() => {
  cleanup();
  post.mockReset();
  BASE_PROPS.onCancel.mockReset();
  BASE_PROPS.onSaved.mockReset();
});

describe("EmployeeForm add flow", () => {
  it("shows a visible error summary instead of failing silently", () => {
    const { container } = renderForm();

    fireEvent.submit(container.querySelector("form"));

    const summary = screen.getByText("Could not save this employee").closest("[role='alert']");
    expect(summary).toBeTruthy();
    expect(within(summary).getByText("Format: 00000-0000000-0 (13 digits)")).toBeTruthy();
    expect(within(summary).getByText(/Add an email for the sign-in account/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("creates the HR record and invites the employee in one action", async () => {
    const onSaved = vi.fn();
    post
      .mockResolvedValueOnce({
        employee: { id: "e1", name: "Test Person", emp_code: "EMP-100" },
      })
      .mockResolvedValueOnce({ emailed: true, invite_link: null, temporary_password: null });

    const { container } = renderForm({ onSaved });
    fillRequiredFields();
    fireEvent.submit(container.querySelector("form"));

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        "Test Person was added. Invite emailed to test@example.com."
      )
    );

    // Geo-fencing now defaults off, so a quick add cannot be rejected by the
    // "assign at least one location" rule.
    expect(post).toHaveBeenNthCalledWith(
      1,
      "/api/monitor/employees",
      expect.objectContaining({ geofencing_enabled: false, cnic: "35202-1234567-1" })
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/api/employees",
      expect.objectContaining({
        mode: "invite",
        employee_id: "e1",
        email: "test@example.com",
      })
    );
  });

  it("shows a copyable invite link when automatic email is not configured", async () => {
    const onSaved = vi.fn();
    post
      .mockResolvedValueOnce({
        employee: { id: "e2", name: "Test Person", emp_code: "EMP-101" },
      })
      .mockResolvedValueOnce({
        emailed: false,
        email_error: "not-configured",
        invite_link: "https://example.com/welcome#access_token=abc",
      });

    const { container } = renderForm({ onSaved });
    fillRequiredFields();
    fireEvent.submit(container.querySelector("form"));

    expect(
      await screen.findByText("https://example.com/welcome#access_token=abc")
    ).toBeTruthy();
    expect(screen.getByText("Invite link")).toBeTruthy();

    const done = screen.getByRole("button", { name: /confirm you have saved them/i });
    expect(done.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /saved these details/i }));
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(onSaved).toHaveBeenCalledWith("Test Person was added.");
  });

  it("falls back to a temporary password when chosen", async () => {
    const onSaved = vi.fn();
    post
      .mockResolvedValueOnce({
        employee: { id: "e3", name: "Test Person", emp_code: "EMP-102" },
      })
      .mockResolvedValueOnce({ temporary_password: "Str0ngPass!23" });

    const { container } = renderForm({ onSaved });
    fireEvent.click(screen.getByRole("radio", { name: /create a temporary password/i }));
    fillRequiredFields();
    fireEvent.submit(container.querySelector("form"));

    expect(await screen.findByText("Str0ngPass!23")).toBeTruthy();
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/api/employees",
      expect.objectContaining({ mode: "password" })
    );
  });
});
