import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MonthSummary } from "../api.js";
import { BucketMeter } from "./BucketMeter.js";

type BucketFigures = MonthSummary["buckets"][number];

const bucket = (over: Partial<BucketFigures> = {}): BucketFigures => ({
  id: "meals",
  name: "Meals",
  group: "living",
  planned: 600,
  posted: 180,
  pending: 0,
  expectedByToday: 200,
  pace: "on-pace",
  remaining: 420,
  ...over,
});

function renderMeter(b: BucketFigures) {
  const { container } = render(
    <ul>
      <BucketMeter bucket={b} currency="USD" />
    </ul>,
  );
  return container.querySelector("li")!;
}

describe("BucketMeter", () => {
  it("shows spent against plan, what is left and the pace", () => {
    const item = renderMeter(bucket());
    expect(item).toHaveClass("pace-on-pace");
    expect(screen.getByText("On pace")).toBeInTheDocument();
    expect(screen.getByText("$420.00 left")).toBeInTheDocument();
    const meter = screen.getByRole("meter", { name: "Meals" });
    expect(meter).toHaveAttribute("aria-valuetext", "$180.00 of $600 spent, on pace");
    expect(item.querySelector<HTMLElement>(".meter-posted")!.style.width).toBe("30%");
    expect(item.querySelector<HTMLElement>(".meter-expected")!.style.left).toBe("33.3%");
  });

  it("draws pending as its own greyed segment and leaves it out of the figures", () => {
    const item = renderMeter(bucket({ pending: 60 }));
    const segment = item.querySelector<HTMLElement>(".meter-pending")!;
    expect(segment.style.left).toBe("30%");
    expect(segment.style.width).toBe("10%");
    expect(item.querySelector(".meter-pending-note")).toHaveTextContent("$60.00 pending");
    expect(screen.getByText("$420.00 left")).toBeInTheDocument();
  });

  it("flags an overspent bucket with the overage and the plan line", () => {
    const item = renderMeter(bucket({ posted: 750, remaining: -150, pace: "over", expectedByToday: 600 }));
    expect(item).toHaveClass("pace-over");
    expect(screen.getByText("Over")).toBeInTheDocument();
    expect(screen.getByText("$150.00 over")).toBeInTheDocument();
    expect(item.querySelector<HTMLElement>(".meter-plan")!.style.left).toBe("80%");
  });

  it("keeps the footer in step with the pace when spending lands exactly on the plan", () => {
    renderMeter(bucket({ posted: 600, remaining: 0, pace: "over" }));
    expect(screen.getByText("Over")).toBeInTheDocument();
    expect(screen.getByText("$0.00 over")).toBeInTheDocument();
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
  });

  it("gives an unplanned bucket a valid meter range", () => {
    renderMeter(bucket({ planned: 0, posted: 30, remaining: -30, pace: "over", expectedByToday: 0 }));
    const meter = screen.getByRole("meter", { name: "Meals" });
    expect(meter).toHaveAttribute("aria-valuemax", "30");
    expect(meter).toHaveAttribute("aria-valuenow", "30");

    renderMeter(bucket({ id: "gifts", name: "Gifts", planned: 0, posted: 0, remaining: 0, expectedByToday: 0 }));
    expect(screen.getByRole("meter", { name: "Gifts" })).toHaveAttribute("aria-valuemax", "1");
  });

  it("badges a running streak beside the name without renaming the meter", () => {
    render(
      <ul>
        <BucketMeter bucket={bucket()} currency="USD" streak={{ id: "meals", name: "Meals", current: 4, best: 6 }} />
      </ul>,
    );
    expect(screen.getByText("4-month streak")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Meals" })).toBeInTheDocument();
  });

  it("draws no expected-by-today tick on a fixed bucket, which is not prorated", () => {
    const item = renderMeter(bucket({ id: "rent", name: "Rent", group: "fixed", planned: 1200, posted: 1200, remaining: 0, expectedByToday: null }));
    expect(item.querySelector(".meter-expected")).toBeNull();
    expect(item.querySelector<HTMLElement>(".meter-posted")!.style.width).toBe("100%");
    expect(screen.getByText("On pace")).toBeInTheDocument();
  });

  it("labels a bucket trending over", () => {
    const item = renderMeter(bucket({ posted: 300, remaining: 300, pace: "trending-over" }));
    expect(item).toHaveClass("pace-trending-over");
    expect(screen.getByText("Trending over")).toBeInTheDocument();
  });
});
