import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPatch, AccountsResponse, AccountUpdateResponse, AccountView } from "../api.js";
import { AccountsPage } from "./AccountsPage.js";

const api = vi.hoisted(() => ({
  getAccounts: vi.fn<() => Promise<AccountsResponse>>(),
  updateAccount: vi.fn<(id: number, body: AccountPatch) => Promise<AccountUpdateResponse>>(),
}));
vi.mock("../api.js", () => api);

const at = "2026-09-10T08:00:00.000Z";
function acct(over: Partial<AccountView> & Pick<AccountView, "id" | "name">): AccountView {
  return { connector: "simplefin", externalId: `ext-${over.id}`, institution: "Example Bank", type: "checking", role: null, linkedGoalIds: [], linkedDebtId: null, createdAt: at, balance: null, ...over };
}

const checking = acct({ id: 1, name: "Everyday Checking", balance: { amount: 1234.5, at } });
const card = acct({ id: 2, name: "Rewards Card", institution: "Card Issuer", type: "credit", role: "card", balance: { amount: -800, at } });
const savings = acct({ id: 3, name: "Rainy Day", type: "savings", role: "savings", linkedGoalIds: ["rainy-day"] });

function response(accounts: AccountView[], over: Partial<AccountsResponse> = {}): AccountsResponse {
  return {
    accounts,
    debts: [
      { id: "card-a", name: "Card A" },
      { id: "card-b", name: "Card B" },
    ],
    goals: [
      { id: "rainy-day", name: "Rainy day fund" },
      { id: "bills", name: "Bills fund" },
    ],
    currency: "USD",
    planOk: true,
    ...over,
  };
}

/** Answers every PATCH as the server would: the account with the change applied. */
function saveLikeServer(start: AccountView[]) {
  const byId = new Map(start.map((a) => [a.id, a]));
  api.updateAccount.mockImplementation(async (id, body) => {
    const next = { ...byId.get(id), ...body } as AccountView;
    byId.set(id, next);
    return { account: next, categorized: { applied: true, counts: null, warnings: [] } };
  });
}

const row = (name: string) => screen.findByRole("listitem", { name });

beforeEach(() => {
  api.getAccounts.mockReset().mockResolvedValue(response([checking, card, savings]));
  api.updateAccount.mockReset();
});

describe("AccountsPage", () => {
  it("lists each account with institution, type, latest balance, role and links", async () => {
    render(<AccountsPage />);
    const chk = await row("Everyday Checking");
    expect(chk).toHaveTextContent("Example Bank · checking");
    expect(chk).toHaveTextContent("$1,234.50");
    expect(within(chk).getByRole("combobox", { name: "Role" })).toHaveValue("");
    expect(within(within(chk).getByRole("combobox", { name: "Role" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Not set", "Checking", "Savings", "Card", "Ignore"]);
    expect(within(chk).queryByRole("combobox", { name: "Pays down" })).not.toBeInTheDocument();
    expect(within(chk).queryByRole("group", { name: "Funds goals" })).not.toBeInTheDocument();

    const cardRow = screen.getByRole("listitem", { name: "Rewards Card" });
    expect(cardRow).toHaveTextContent("Card Issuer · credit");
    expect(cardRow).toHaveTextContent("-$800.00");
    expect(within(cardRow).getByRole("combobox", { name: "Role" })).toHaveValue("card");
    expect(within(cardRow).getByRole("combobox", { name: "Pays down" })).toHaveValue("");

    const sav = screen.getByRole("listitem", { name: "Rainy Day" });
    expect(sav).toHaveTextContent("No balance yet");
    const goals = within(sav).getByRole("group", { name: "Funds goals" });
    expect(within(goals).getByRole("checkbox", { name: "Rainy day fund" })).toBeChecked();
    expect(within(goals).getByRole("checkbox", { name: "Bills fund" })).not.toBeChecked();
  });

  it("saves a role at once, then offers and saves the card's debt link", async () => {
    saveLikeServer([checking]);
    render(<AccountsPage />);
    const chk = await row("Everyday Checking");
    fireEvent.change(within(chk).getByRole("combobox", { name: "Role" }), { target: { value: "card" } });
    expect(api.updateAccount).toHaveBeenCalledWith(1, { role: "card" });

    const debt = await within(chk).findByRole("combobox", { name: "Pays down" });
    await waitFor(() => expect(debt).toBeEnabled());
    expect(within(debt).getAllByRole("option").map((o) => o.textContent)).toEqual(["No debt linked", "Card A", "Card B"]);
    fireEvent.change(debt, { target: { value: "card-b" } });
    expect(api.updateAccount).toHaveBeenLastCalledWith(1, { linkedDebtId: "card-b" });
    await waitFor(() => expect(within(chk).getByRole("combobox", { name: "Pays down" })).toHaveValue("card-b"));
    expect(within(chk).getByRole("combobox", { name: "Role" })).toHaveValue("card");
  });

  it("toggles a savings account's goals as a multi-select", async () => {
    saveLikeServer([savings]);
    render(<AccountsPage />);
    const sav = await row("Rainy Day");
    fireEvent.click(within(sav).getByRole("checkbox", { name: "Bills fund" }));
    expect(api.updateAccount).toHaveBeenCalledWith(3, { linkedGoalIds: ["rainy-day", "bills"] });
    await waitFor(() => expect(within(sav).getByRole("checkbox", { name: "Bills fund" })).toBeChecked());

    fireEvent.click(within(sav).getByRole("checkbox", { name: "Rainy day fund" }));
    expect(api.updateAccount).toHaveBeenLastCalledWith(3, { linkedGoalIds: ["bills"] });
    await waitFor(() => expect(within(sav).getByRole("checkbox", { name: "Rainy day fund" })).not.toBeChecked());
  });

  it("shows a refused save and puts the previous value back", async () => {
    let refuse!: (err: Error) => void;
    api.updateAccount.mockImplementation(() => new Promise((_, reject) => (refuse = reject)));
    render(<AccountsPage />);
    const cardRow = await row("Rewards Card");
    const role = within(cardRow).getByRole("combobox", { name: "Role" });
    fireEvent.change(role, { target: { value: "ignore" } });
    expect(role).toHaveValue("ignore");
    expect(role).toBeDisabled();

    refuse(new Error("The server said no"));
    expect(await within(cardRow).findByRole("alert")).toHaveTextContent("Not saved: The server said no");
    expect(role).toHaveValue("card");
    expect(role).toBeEnabled();
    expect(within(cardRow).getByRole("combobox", { name: "Pays down" })).toBeInTheDocument();
  });

  it("points at Settings when there are no accounts yet", async () => {
    api.getAccounts.mockResolvedValue(response([]));
    render(<AccountsPage />);
    expect(await screen.findByRole("heading", { name: "No accounts yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect SimpleFIN or import a CSV" })).toBeInTheDocument();
  });

  it("keeps roles editable but links unavailable while the plan does not load", async () => {
    api.getAccounts.mockResolvedValue(response([card], { debts: [], goals: [], planOk: false }));
    render(<AccountsPage />);
    const cardRow = await row("Rewards Card");
    expect(screen.getByText(/Linking debts and goals needs a valid plan file/)).toBeInTheDocument();
    expect(within(cardRow).getByRole("combobox", { name: "Role" })).toBeEnabled();
    expect(within(cardRow).getByRole("combobox", { name: "Pays down" })).toBeDisabled();
  });
});
