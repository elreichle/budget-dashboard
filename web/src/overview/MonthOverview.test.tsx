import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthList, MonthSummary } from "../api.js";
import { MonthOverview } from "./MonthOverview.js";

const api = vi.hoisted(() => ({
  listMonths: vi.fn<() => Promise<MonthList>>(),
  getMonth: vi.fn<(month: string) => Promise<MonthSummary>>(),
}));
vi.mock("../api.js", () => api);

const summary = (month: string, over: Partial<MonthSummary> = {}): MonthSummary => ({
  month,
  daysInMonth: 30,
  daysElapsed: 10,
  closed: false,
  buckets: [
    { id: "rent", name: "Rent", group: "fixed", planned: 1500, posted: 1500, pending: 0, expectedByToday: null, pace: "on-pace", remaining: 0 },
    { id: "meals", name: "Meals", group: "living", planned: 600, posted: 150, pending: 40, expectedByToday: 200, pace: "on-pace", remaining: 450 },
  ],
  income: { planned: 5000, received: 2500, pending: 0 },
  savings: [],
  debts: [],
  uncategorizedCount: 3,
  totals: { planned: 2100, posted: 1650, pending: 40 },
  ...over,
});

beforeEach(() => {
  window.location.hash = "";
  api.listMonths.mockReset().mockResolvedValue({ months: ["2026-09", "2026-08", "2026-07"], current: "2026-09" });
  api.getMonth.mockReset().mockImplementation(async (month) => summary(month));
});

describe("MonthOverview", () => {
  it("badges streaks on the current month's meters only", async () => {
    render(<MonthOverview currency="USD" streaks={[{ id: "meals", name: "Meals", current: 3, best: 3 }]} />);
    expect(await screen.findByText("3-month streak")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Month" }), { target: { value: "2026-08" } });
    expect(await screen.findByRole("heading", { name: "August 2026" })).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText("3-month streak")).not.toBeInTheDocument();
  });

  it("opens on the current month with meters grouped into fixed and living", async () => {
    render(<MonthOverview currency="USD" />);
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await waitFor(() => expect(api.getMonth).toHaveBeenCalledWith("2026-09"));
    const fixed = await screen.findByRole("region", { name: "Fixed" });
    const living = screen.getByRole("region", { name: "Living" });
    expect(within(fixed).getByRole("meter", { name: "Rent" })).toBeInTheDocument();
    expect(within(living).getByRole("meter", { name: "Meals" })).toBeInTheDocument();
    const totals = screen.getByText("20 days left").closest("p");
    expect(totals).toHaveTextContent("Spent $1,650.00 of $2,100 · $40.00 pending");
  });

  it("leaves out a group with no buckets", async () => {
    api.getMonth.mockImplementation(async (month) => ({ ...summary(month), buckets: summary(month).buckets.filter((b) => b.group === "living") }));
    render(<MonthOverview currency="USD" />);
    expect(await screen.findByRole("region", { name: "Living" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fixed" })).not.toBeInTheDocument();
  });

  it("links the uncategorized count to the review inbox, and hides it at zero", async () => {
    const { unmount } = render(<MonthOverview currency="USD" />);
    expect(await screen.findByRole("link", { name: "3 transactions need a bucket" })).toHaveAttribute("href", "#/transactions");
    unmount();

    api.getMonth.mockImplementation(async (month) => summary(month, { uncategorizedCount: 0 }));
    render(<MonthOverview currency="USD" />);
    await screen.findByRole("meter", { name: "Meals" });
    expect(screen.queryByRole("link", { name: /need/ })).not.toBeInTheDocument();
  });

  it("switches to a past month from the picker without remounting the meters", async () => {
    render(<MonthOverview currency="USD" />);
    const meals = await screen.findByRole("meter", { name: "Meals" });
    const picker = screen.getByRole("combobox", { name: "Month" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["September 2026 (this month)", "August 2026", "July 2026"]);

    api.getMonth.mockImplementation(async (month) => summary(month, { closed: true, daysElapsed: 31, daysInMonth: 31 }));
    await act(async () => {
      fireEvent.change(picker, { target: { value: "2026-08" } });
    });
    expect(api.getMonth).toHaveBeenLastCalledWith("2026-08");
    expect(await screen.findByRole("heading", { name: "August 2026" })).toBeInTheDocument();
    expect(await screen.findByText("Month closed")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Meals" })).toBe(meals);
  });

  it("offers the current month even before it has transactions", async () => {
    api.listMonths.mockResolvedValue({ months: ["2026-08"], current: "2026-09" });
    render(<MonthOverview currency="USD" />);
    const picker = await screen.findByRole("combobox", { name: "Month" });
    expect(within(picker).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["2026-09", "2026-08"]);
  });

  it("reports a month that fails to load", async () => {
    api.getMonth.mockRejectedValue(new Error("Cannot summarize a month without a valid plan"));
    render(<MonthOverview currency="USD" />);
    expect(await screen.findByRole("heading", { name: /could not load this month/i })).toBeInTheDocument();
    expect(screen.getByText("Cannot summarize a month without a valid plan")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
