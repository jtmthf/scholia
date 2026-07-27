// The guards on POST /__open, as a pure decision (ADR-0017, ADR-0022).
//
// This endpoint spawns a process from a request parameter, so its guards are
// the whole reason it's allowed to exist. They're separated from the route so
// each one is testable in isolation — `Host` in particular is a forbidden
// header for `fetch`, and so unreachable from an integration test.

export interface OpenRequestInfo {
  method: string;
  /** Case-insensitive header lookup — Hono's `c.req.header`. */
  header: (name: string) => string | undefined;
  /** The peer address of the underlying socket, when the transport exposes one. */
  remoteAddress?: string | null;
}

export interface OpenRejection {
  status: 405 | 403;
  error: string;
}

// Headers a reverse proxy or tunnel adds on the way through. A tunnel provider
// (cloudflared, ngrok, tailscale funnel) runs on this machine and connects to
// the server over loopback, so the peer address alone can't tell a tunnelled
// request from a local one — these can.
const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "ngrok-skip-browser-warning",
  "x-original-forwarded-for",
];

/** 127.0.0.0/8, ::1, and the IPv4-mapped form Node reports on dual-stack sockets. */
export function isLoopbackAddress(address: string): boolean {
  const addr = address.replace(/^::ffff:/i, "").replace(/%.*$/, "");
  if (addr === "::1" || addr === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

// The Host header as the browser sent it: `localhost:3000`, `127.0.0.1:3000`,
// `[::1]:3000`. A tunnelled request carries the tunnel's public hostname here.
export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\]/.exec(trimmed);
  const hostname = bracketed ? bracketed[1]! : trimmed.split(":")[0]!;
  // `*.localhost` resolves to loopback per RFC 6761 and is used for local subdomains.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return isLoopbackAddress(hostname);
}

// Returns the rejection to send, or null when the request may proceed. Order
// matters: cheapest and most specific first, so a plain GET reads as "method
// not allowed" rather than something about tunnels.
export function checkOpenRequest(req: OpenRequestInfo): OpenRejection | null {
  if (req.method !== "POST") {
    return { status: 405, error: "method not allowed" };
  }

  // Local Preview binds loopback on both stacks, which means any page in the
  // user's browser can reach it; without this check a random tab could make
  // the editor open files.
  const site = req.header("Sec-Fetch-Site");
  if (site && site !== "same-origin") {
    return { status: 403, error: "cross-site request rejected" };
  }

  for (const name of PROXY_HEADERS) {
    if (req.header(name) !== undefined) {
      return { status: 403, error: "tunnelled request rejected — /__open is loopback-only" };
    }
  }

  const remote = req.remoteAddress;
  if (remote && !isLoopbackAddress(remote)) {
    return { status: 403, error: "non-loopback request rejected" };
  }

  const host = req.header("Host");
  if (!host || !isLoopbackHost(host)) {
    return { status: 403, error: "non-loopback request rejected" };
  }

  return null;
}
