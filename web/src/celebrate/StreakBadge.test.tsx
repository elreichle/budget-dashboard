import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreakBadge } from "./StreakBadge.js";

describe("StreakBadge", () => {
  it("counts the current run and offers the best one", () => {
    render(<StreakBadge streak={{ id: "meals", name: "Meals", current: 3, best: 5 }} />);
    expect(screen.getByText("3-month streak")).toHaveAttribute("title", "Best run: 5 months");
  });

  it("shows nothing without a current run", () => {
    const { container } = render(
      <>
        <StreakBadge streak={{ id: "meals", name: "Meals", current: 0, best: 4 }} />
        <StreakBadge streak={undefined} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
