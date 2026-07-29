import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { LocationProvider, Route, Router } from "preact-iso";
import { SITE_ROUTE } from "./routes.js";
import { SiteView } from "./shell/SiteView.js";
import { NotFoundView } from "./shell/states.js";

/**
 * The viewer's root: a query cache, a router, and one real route (ADR-0011).
 *
 * `url` is set when rendering on the server and omitted in the browser, where the
 * router reads the address bar and takes over same-origin link clicks. Everything
 * below this is reachable from either side.
 */
export function App({ client, url }: { client: QueryClient; url?: string }) {
  return (
    <QueryClientProvider client={client}>
      <LocationProvider {...(url ? { url } : {})}>
        <Router>
          <Route path={SITE_ROUTE} component={SiteView} />
          <Route default component={NotFoundView} />
        </Router>
      </LocationProvider>
    </QueryClientProvider>
  );
}
