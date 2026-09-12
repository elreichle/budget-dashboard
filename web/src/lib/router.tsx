import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * A hash router: the path lives after `#` so the server's static fallback never has to know
 * about routes and a reload lands on the same screen. `/#/accounts` → path `/accounts`.
 */

export function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "" || hash === "/") return "/";
  return hash.startsWith("/") ? hash : `/${hash}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current route path; re-renders on navigation. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath, () => "/");
}

export function navigate(path: string): void {
  window.location.hash = path;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  children: ReactNode;
}

/** An anchor to a route; carries `aria-current="page"` while it is the active one. */
export function Link({ to, children, ...rest }: LinkProps) {
  const path = usePath();
  return (
    <a href={`#${to}`} aria-current={path === to ? "page" : undefined} {...rest}>
      {children}
    </a>
  );
}
