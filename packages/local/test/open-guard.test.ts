import { describe, expect, test } from "vitest";
import { checkOpenRequest } from "../src/open-guard.js";

// The guards on POST /__open, tested at the pure decision function rather than
// over HTTP: `Host` is a forbidden header for `fetch`, so the loopback checks
// can't be driven from an integration test. The HTTP-reachable guards are
// exercised end-to-end in open.test.ts.
function request(
  overrides: {
    method?: string;
    headers?: Record<string, string>;
    remoteAddress?: string | null;
  } = {},
) {
  const headers: Record<string, string> = { host: "localhost:3000", ...overrides.headers };
  return {
    method: overrides.method ?? "POST",
    header: (name: string) => headers[name.toLowerCase()],
    remoteAddress: overrides.remoteAddress === undefined ? "127.0.0.1" : overrides.remoteAddress,
  };
}

describe("checkOpenRequest", () => {
  test("allows a same-origin POST from loopback", () => {
    expect(checkOpenRequest(request({ headers: { "sec-fetch-site": "same-origin" } }))).toBeNull();
  });

  test("allows a request with no Sec-Fetch-Site at all (e.g. curl)", () => {
    expect(checkOpenRequest(request())).toBeNull();
  });

  test("rejects anything that is not a POST", () => {
    expect(checkOpenRequest(request({ method: "GET" }))?.status).toBe(405);
  });

  test("rejects a cross-site Sec-Fetch-Site", () => {
    expect(checkOpenRequest(request({ headers: { "sec-fetch-site": "cross-site" } }))?.status).toBe(
      403,
    );
  });

  test("rejects a same-site (but not same-origin) Sec-Fetch-Site", () => {
    expect(checkOpenRequest(request({ headers: { "sec-fetch-site": "same-site" } }))?.status).toBe(
      403,
    );
  });

  // ADR-0022: the endpoint is loopback-only unconditionally. Every guard above
  // rests on the server being reachable only from this machine.
  test("allows the IPv6 loopback and IPv4-mapped forms", () => {
    expect(
      checkOpenRequest(request({ remoteAddress: "::1", headers: { host: "[::1]:3000" } })),
    ).toBeNull();
    expect(checkOpenRequest(request({ remoteAddress: "::ffff:127.0.0.1" }))).toBeNull();
    expect(checkOpenRequest(request({ remoteAddress: "127.1.2.3" }))).toBeNull();
  });

  test("rejects a request from a non-loopback peer (--host on a LAN)", () => {
    const rejection = checkOpenRequest(request({ remoteAddress: "192.168.1.24" }));
    expect(rejection?.status).toBe(403);
    expect(rejection?.error).toMatch(/loopback/);
  });

  test("rejects a request whose Host is not a loopback address", () => {
    const rejection = checkOpenRequest(request({ headers: { host: "docs.example.com" } }));
    expect(rejection?.status).toBe(403);
    expect(rejection?.error).toMatch(/loopback/);
  });

  test("rejects a missing Host header", () => {
    const rejection = checkOpenRequest({
      method: "POST",
      header: () => undefined,
      remoteAddress: "127.0.0.1",
    });
    expect(rejection?.status).toBe(403);
  });

  // A tunnel provider runs on this machine, so its proxied requests arrive
  // from loopback. The forwarding headers are what give them away.
  test.each([
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "forwarded",
    "cf-connecting-ip",
    "cf-ray",
    "x-real-ip",
    "ngrok-skip-browser-warning",
  ])("rejects a tunnelled request carrying %s", (header: string) => {
    const rejection = checkOpenRequest(request({ headers: { [header]: "1" } }));
    expect(rejection?.status).toBe(403);
    expect(rejection?.error).toMatch(/tunnel/i);
  });
});
