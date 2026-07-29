import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { SiteNotFoundError, type NavNode } from "../api.js";
import { useSite } from "../data/queries.js";
import { useOwnerToken, useViewerId } from "../data/identity.js";
import { pinnedVersion, sitePath, type SiteRouteParams } from "../routes.js";
import { PageView } from "../page/PageView.js";
import { Chrome } from "./Chrome.js";
import { HistoricalBanner, NewsBanner } from "./Banners.js";
import { NavTree } from "./NavTree.js";
import { OwnerPanels, useOwnerTokenFromUrl, type Panel } from "./OwnerPanels.js";
import { ErrorView, LoadingView, NotFoundView } from "./states.js";

function countFiles(nodes: NavNode[]): number {
  return nodes.reduce((n, node) => {
    if (node.type === "file") return n + 1;
    return n + countFiles(node.children ?? []);
  }, 0);
}

/**
 * One Site at one Page, the viewer's only real route.
 *
 * It resolves the URL into a Site plus a Page, decides the two postures that change
 * everything below it — is this Latest, and is the reader the Owner — and then lays
 * out chrome, banners, Nav and the Page. It holds no comment state: that belongs to
 * PageView, which owns the content surface the comments attach to.
 */
export function SiteView({ slug, pagePath }: SiteRouteParams) {
  const { query, route } = useLocation();
  const version = pinnedVersion(query);

  useOwnerTokenFromUrl(slug);
  const ownerToken = useOwnerToken(slug);
  const viewerId = useViewerId(slug);
  const [panel, setPanel] = useState<Panel | null>(null);

  const site = useSite(slug, version);

  if (site.isPending) return <LoadingView />;
  if (site.error) {
    if (site.error instanceof SiteNotFoundError) return <NotFoundView />;
    return <ErrorView message={site.error.message} />;
  }

  const meta = site.data;
  const currentPath = pagePath ?? meta.entryPath;
  const pageTitle = meta.pages.find((p) => p.path === currentPath)?.title ?? currentPath;
  // Nav is for getting between Pages; one Page has nowhere to go.
  const showNav = countFiles(meta.nav) > 1;
  // Reading anything but Latest is a snapshot: no commenting, and one way out.
  const readOnly = !meta.isLatest;
  const togglePanel = (p: Panel) => setPanel((open) => (open === p ? null : p));

  return (
    <div class="viewer">
      <Chrome
        site={meta}
        pageTitle={pageTitle}
        ownerToken={ownerToken}
        onToggleAgentPanel={() => togglePanel("agent")}
        onToggleOwnerPanel={() => togglePanel("manage")}
      />

      <OwnerPanels
        site={meta}
        version={version}
        ownerToken={ownerToken}
        open={panel}
        onClose={() => setPanel(null)}
      />

      {readOnly ? (
        <HistoricalBanner site={meta} onGoLatest={() => route(sitePath(slug, currentPath))} />
      ) : (
        <NewsBanner key={`${slug}:${version}`} site={meta} viewerId={viewerId} />
      )}

      <div class="body">
        {showNav && (
          <nav class="nav">
            <NavTree
              nodes={meta.nav}
              currentPath={currentPath}
              slug={slug}
              version={readOnly ? meta.version : null}
            />
          </nav>
        )}
        <PageView
          site={meta}
          currentPath={currentPath}
          pageTitle={pageTitle}
          readOnly={readOnly}
          ownerToken={ownerToken}
          onBringAgent={() => setPanel("viewer-agent")}
        />
      </div>
    </div>
  );
}
