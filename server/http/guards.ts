import { isIPv6 } from "node:net";
import type { MiddlewareHandler } from "hono";

/** Names this machine answers to from its own browser. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Guards `/api` against DNS rebinding: a hostile page can point its own domain at 127.0.0.1 and
 * call the API from the browser, but the Host header still carries that domain. A request whose
 * Host is neither loopback nor in `allowedHosts` (lower-cased hostnames) gets 403 `forbidden_host`.
 */
export function hostGuard(allowedHosts: readonly string[]): MiddlewareHandler {
  const allowed = new Set([...LOOPBACK_HOSTS, ...allowedHosts]);
  return async (c, next) => {
    // @hono/node-server builds the URL from Host, so the URL stands in when there is no header.
    const hostname = hostnameOf(c.req.header("host") ?? new URL(c.req.url).host);
    if (hostname === null || !allowed.has(hostname)) return c.json({ error: "forbidden_host" }, 403);
    await next();
  };
}

/** Methods that only read; everything else changes state. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Guards `/api` state changes against cross-site requests: a page on another origin can still send a
 * form or a no-cors fetch to localhost. A non-read request gets 403 `cross_site` when the browser
 * marks it `Sec-Fetch-Site` other than `same-origin`/`none`, or its `Origin` is not the Host it is
 * addressed to. Requests with neither header (curl, scripts) are not from a browser and pass.
 */
export function crossSiteGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (!READ_METHODS.has(c.req.method)) {
      const site = c.req.header("sec-fetch-site")?.toLowerCase();
      const origin = c.req.header("origin");
      const host = c.req.header("host") ?? new URL(c.req.url).host;
      const crossSite = (site !== undefined && site !== "same-origin" && site !== "none") || (origin !== undefined && !originMatchesHost(origin, host));
      if (crossSite) return c.json({ error: "cross_site" }, 403);
    }
    await next();
  };
}

/** Whether an `Origin` value names the same host and port as a Host value; an opaque `null` origin never does. */
function originMatchesHost(origin: string, host: string): boolean {
  if (!host || /[\s/?#@\\]/.test(host)) return false;
  try {
    const url = new URL(origin);
    if (url.origin === "null") return false;
    // Parsing Host under the Origin's scheme drops the default port the way the Origin already does.
    return new URL(`${url.protocol}//${host}`).host === url.host;
  } catch {
    return false;
  }
}

/** The Host a browser sends to reach a listen address, or null for a wildcard (0.0.0.0, ::), which has no single name. */
export function hostForAddress(address: string): string | null {
  if (address === "0.0.0.0" || address === "::") return null;
  return hostnameOf(isIPv6(address) ? `[${address}]` : address);
}

/** The lower-cased hostname in a Host value (`name`, `name:port`, `[v6]:port`), or null when it is not one. */
export function hostnameOf(host: string): string | null {
  if (!host || /[\s/?#@\\]/.test(host)) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}
