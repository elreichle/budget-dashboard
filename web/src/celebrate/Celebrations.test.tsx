import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MilestonesResponse, MilestoneView } from "../api.js";
import { Celebrations, MILESTONE_POLL_MS } from "./Celebrations.js";
import { Confetti } from "./Confetti.js";
import { claimCelebration, forgetCelebrations } from "./session.js";

const api = vi.hoisted(() => ({
  getMilestones: vi.fn<() => Promise<MilestonesResponse>>(),
  dismissMilestone: vi.fn<(id: number) => Promise<unknown>>(),
}));
vi.mock("../api.js", () => api);
const confetti = vi.hoisted(() => ({ burst: vi.fn<() => () => boolean>() }));
vi.mock("./burst.js", () => confetti);

const milestone = (over: Partial<MilestoneView> & Pick<MilestoneView, "id" | "kind" | "subject" | "firstSeen">): MilestoneView => ({
  key: over.subject.id,
  dismissed: false,
  month: null,
  ...over,
});

const paidOff = milestone({ id: 1, kind: "debt-paid", subject: { type: "debt", id: "card-a", name: "Card A" }, firstSeen: "2026-08-20T08:00:00.000Z" });
const underPlan = milestone({ id: 2, kind: "month-under-plan", key: "meals:2026-08", subject: { type: "bucket", id: "meals", name: "Meals" }, month: "2026-08", firstSeen: "2026-09-01T08:00:00.000Z" });
const halfway = milestone({ id: 3, kind: "debt-halfway", dismissed: true, subject: { type: "debt", id: "card-b", name: "Card B" }, firstSeen: "2026-06-03T08:00:00.000Z" });

/** Like the server: oldest first to celebrate, newest first in the history. */
function response(...all: MilestoneView[]): MilestonesResponse {
  const byAge = [...all].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  return { undismissed: byAge.filter((m) => !m.dismissed), history: [...byAge].reverse() };
}

const toast = () => within(screen.getByRole("status"));

beforeEach(() => {
  forgetCelebrations();
  api.getMilestones.mockReset().mockResolvedValue(response(paidOff, underPlan, halfway));
  api.dismissMilestone.mockReset().mockResolvedValue({});
  confetti.burst.mockReset().mockReturnValue(() => false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Celebrations", () => {
  it("celebrates the oldest undismissed milestone with a toast and a confetti burst", async () => {
    render(<Celebrations />);
    expect(await toast().findByText("Card A is paid off!")).toBeInTheDocument();
    expect(toast().getByText("1 more to celebrate")).toBeInTheDocument();
    await waitFor(() => expect(confetti.burst).toHaveBeenCalledTimes(1));
  });

  it("dismisses on the server, then celebrates the next one", async () => {
    render(<Celebrations />);
    const dismiss = await toast().findByRole("button", { name: "Dismiss" });
    api.getMilestones.mockResolvedValue(response({ ...paidOff, dismissed: true }, underPlan, halfway));
    fireEvent.click(dismiss);
    expect(api.dismissMilestone).toHaveBeenCalledWith(1);
    expect(await toast().findByText("Meals finished August 2026 under plan")).toBeInTheDocument();
    expect(toast().queryByText("Card A is paid off!")).not.toBeInTheDocument();
    await waitFor(() => expect(api.getMilestones).toHaveBeenCalledTimes(2));
    expect(confetti.burst).toHaveBeenCalledTimes(2);
  });

  it("plays each milestone's confetti only once per session", async () => {
    const first = render(<Celebrations />);
    await toast().findByText("Card A is paid off!");
    first.unmount();
    render(<Celebrations />);
    expect(await toast().findByText("Card A is paid off!")).toBeInTheDocument();
    expect(confetti.burst).toHaveBeenCalledTimes(1);
  });

  it("brings the milestone back with the reason when dismissing fails", async () => {
    api.dismissMilestone.mockRejectedValue(new Error("Server unreachable"));
    render(<Celebrations />);
    fireEvent.click(await toast().findByRole("button", { name: "Dismiss" }));
    expect(await toast().findByText("Could not dismiss: Server unreachable")).toBeInTheDocument();
    expect(toast().getByText("Card A is paid off!")).toBeInTheDocument();
  });

  it("lists every win newest first with the day it was reached", async () => {
    render(<Celebrations />);
    const wins = screen.getByRole("region", { name: "Wins" });
    const items = await within(wins).findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Meals finished August 2026 under planSep 1, 2026", "Card A is paid off!Aug 20, 2026", "Card B is halfway paid offJun 3, 2026"]);
  });

  it("says when there are no wins yet, with no toast and no confetti", async () => {
    api.getMilestones.mockResolvedValue(response());
    render(<Celebrations />);
    expect(await screen.findByText(/^No wins yet/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(confetti.burst).not.toHaveBeenCalled();
  });

  it("keeps checking, so a milestone reached by a background sync still gets its moment", async () => {
    vi.useFakeTimers();
    api.getMilestones.mockResolvedValueOnce(response()).mockResolvedValue(response(paidOff));
    render(<Celebrations />);
    await act(async () => {});
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => vi.advanceTimersByTime(MILESTONE_POLL_MS));
    await act(async () => {});
    expect(toast().getByText("Card A is paid off!")).toBeInTheDocument();
    expect(confetti.burst).toHaveBeenCalledTimes(1);
  });
});

describe("Celebrations when the server fails", () => {
  it("keeps the toast, its confetti and the wins up when a poll fails", async () => {
    vi.useFakeTimers();
    api.getMilestones.mockResolvedValueOnce(response(paidOff, halfway)).mockRejectedValue(new Error("Server unreachable"));
    render(<Celebrations />);
    await act(async () => {});
    expect(toast().getByText("Card A is paid off!")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(MILESTONE_POLL_MS));
    await act(async () => {});
    expect(api.getMilestones).toHaveBeenCalledTimes(2);
    expect(toast().getByText("Card A is paid off!")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Wins" })).getAllByRole("listitem")).toHaveLength(2);
    expect(confetti.burst).toHaveBeenCalledTimes(1);
  });

  it("says why when the wins never loaded", async () => {
    api.getMilestones.mockRejectedValue(new Error("Server unreachable"));
    render(<Celebrations />);
    expect(await screen.findByText("Could not load wins: Server unreachable")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("Confetti", () => {
  it("plays for real after StrictMode's rehearsal cuts the first burst short", () => {
    confetti.burst.mockReturnValue(() => true);
    render(
      <StrictMode>
        <Confetti milestoneId={7} />
      </StrictMode>,
    );
    expect(confetti.burst).toHaveBeenCalledTimes(2);
    expect(claimCelebration(7)).toBe(false);
  });
});
