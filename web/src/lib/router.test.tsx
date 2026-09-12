import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Link, currentPath, navigate, usePath } from "./router.js";

function Where() {
  const path = usePath();
  return <output>{path}</output>;
}

describe("hash router", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("reads the path from the hash, defaulting to /", () => {
    expect(currentPath()).toBe("/");
    window.location.hash = "#/accounts";
    expect(currentPath()).toBe("/accounts");
    window.location.hash = "#settings";
    expect(currentPath()).toBe("/settings");
  });

  it("re-renders when the hash changes", async () => {
    render(<Where />);
    expect(screen.getByRole("status")).toHaveTextContent("/");
    await act(async () => {
      navigate("/transactions");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("/transactions");
  });

  it("marks the link to the current path as the current page", async () => {
    window.location.hash = "#/accounts";
    render(
      <nav>
        <Link to="/">Overview</Link>
        <Link to="/accounts">Accounts</Link>
      </nav>,
    );
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#/");
  });
});
