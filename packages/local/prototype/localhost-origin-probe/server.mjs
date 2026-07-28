// PROTOTYPE — throwaway probe for issue #23. See README.md. Delete when answered.
//
// One port, two hostnames. Routes by the Host header: anything under
// `content.<host>` serves the framed content document, everything else serves
// the viewer. Origins are derived from the request's own Host (honouring
// X-Forwarded-*), never hardcoded — so this works unchanged behind a proxy.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { frameHtml, viewerHtml } from "./pages.mjs";

const PORT = Number(process.env.PORT ?? 4123);
const CONTENT_LABEL = "content";

/** Every Host header the browser actually sent, so we can see what resolved. */
const hits = [];

function splitHost(host) {
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return [host.slice(0, close + 1), host.slice(close + 2) || ""];
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? [host, ""] : [host.slice(0, colon), host.slice(colon + 1)];
}

function origins(c) {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? `localhost:${PORT}`;
  const scheme = c.req.header("x-forwarded-proto") ?? "http";
  const [hostname, port] = splitHost(host);

  const prefix = `${CONTENT_LABEL}.`;
  const isContent = hostname.startsWith(prefix);
  const viewerHostname = isContent ? hostname.slice(prefix.length) : hostname;
  const suffix = port ? `:${port}` : "";

  return {
    isContent,
    viewerHostname,
    viewerOrigin: `${scheme}://${viewerHostname}${suffix}`,
    contentOrigin: `${scheme}://${prefix}${viewerHostname}${suffix}`,
  };
}

const app = new Hono();

app.use("*", async (c, next) => {
  hits.push({
    at: new Date().toISOString(),
    host: c.req.header("host") ?? null,
    forwardedHost: c.req.header("x-forwarded-host") ?? null,
    forwardedProto: c.req.header("x-forwarded-proto") ?? null,
    forwardedFor: c.req.header("x-forwarded-for") ?? null,
    path: c.req.path,
  });
  await next();
});

// Credentialled CORS back to the viewer only — needed so the viewer can read
// what the *server* sees, which is the honest view of the cookie jar.
app.use("/probe/*", async (c, next) => {
  const { viewerOrigin } = origins(c);
  c.header("Access-Control-Allow-Origin", viewerOrigin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Vary", "Origin");
  await next();
});

app.get("/", (c) => {
  const o = origins(c);
  if (o.isContent) {
    return c.text(`This is the content Origin (${o.contentOrigin}). Open ${o.viewerOrigin} instead.`);
  }
  return c.html(viewerHtml(o));
});

app.get("/frame", (c) => c.html(frameHtml(origins(c))));

/** Proves the hostname resolved and reached this server. */
app.get("/probe/ping", (c) => {
  const o = origins(c);
  return c.json({ ok: true, host: c.req.header("host") ?? null, origin: o.isContent ? o.contentOrigin : o.viewerOrigin });
});

/** What the server sees in the cookie jar for whichever host was asked. */
app.get("/probe/echo", (c) =>
  c.json({
    host: c.req.header("host") ?? null,
    cookie: c.req.header("cookie") ?? null,
    secFetchSite: c.req.header("sec-fetch-site") ?? null,
  }));

/**
 * Six cookies from the content host. The `Domain=` variants are the leak test:
 * if `localhost` is not treated as a public suffix, they widen to the viewer.
 */
app.get("/probe/set-cookies", (c) => {
  const { viewerHostname } = origins(c);
  const cookies = [
    `p_host_lax=content; Path=/`,
    `p_host_none=content; Path=/; SameSite=None; Secure`,
    `p_dot_lax=content; Path=/; Domain=.${viewerHostname}`,
    `p_dot_none=content; Path=/; Domain=.${viewerHostname}; SameSite=None; Secure`,
    `p_dom_lax=content; Path=/; Domain=${viewerHostname}`,
    `p_dom_none=content; Path=/; Domain=${viewerHostname}; SameSite=None; Secure`,
  ];
  for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
  return c.json({ attempted: cookies });
});

app.get("/probe/hits", (c) => c.json({ hits }));

// Bind loopback on both stacks: the browser decides whether `localhost` and
// `content.localhost` mean 127.0.0.1 or ::1, and guessing wrong would look
// identical to "the hostname didn't resolve" — which is the finding at stake.
const bound = [];
for (const hostname of ["127.0.0.1", "::1"]) {
  try {
    serve({ fetch: app.fetch, port: PORT, hostname });
    bound.push(hostname);
  } catch (error) {
    console.warn(`  (could not bind ${hostname}: ${error.message})`);
  }
}

console.log(`
PROTOTYPE — *.localhost origin probe (issue #23)

  bound on   ${bound.join(", ") || "nothing — that itself is a finding"}
  viewer     http://localhost:${PORT}
  content    http://content.localhost:${PORT}

Open the viewer by hand in Chrome, Firefox and Safari. Copy the report per browser.
`);
