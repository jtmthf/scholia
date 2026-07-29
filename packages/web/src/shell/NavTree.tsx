import { useState } from "preact/hooks";
import type { NavNode } from "../api.js";
import { sitePath } from "../routes.js";

interface NavProps {
  nodes: NavNode[];
  currentPath: string;
  slug: string;
  /** Pinned Version, carried into every link so a permalink stays historical. */
  version: number | null;
}

type NodeProps = Omit<NavProps, "nodes"> & { node: NavNode };

/** Nav derived from Page paths (CONTEXT "Nav"); one file per leaf, no config. */
export function NavTree({ nodes, currentPath, slug, version }: NavProps) {
  return (
    <ul class="nav-list">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <NavDir
            key={node.fsPath}
            node={node}
            currentPath={currentPath}
            slug={slug}
            version={version}
          />
        ) : (
          <NavFile
            key={node.fsPath}
            node={node}
            currentPath={currentPath}
            slug={slug}
            version={version}
          />
        ),
      )}
    </ul>
  );
}

function NavDir({ node, currentPath, slug, version }: NodeProps) {
  const [open, setOpen] = useState(true);
  return (
    <li class="nav-dir">
      <button class="nav-dir-toggle" onClick={() => setOpen((o) => !o)}>
        <span class="nav-dir-arrow">{open ? "▾" : "▸"}</span>
        <span class="nav-dir-text">
          <span class="nav-label">{node.title}</span>
          {node.subtitle && <span class="nav-subtitle">{node.subtitle}</span>}
        </span>
      </button>
      {open && node.children && (
        <NavTree nodes={node.children} currentPath={currentPath} slug={slug} version={version} />
      )}
    </li>
  );
}

// A plain link, deliberately: the router intercepts same-origin clicks itself, so
// this navigates in-place while still being a real URL to middle-click, copy, or
// arrive at cold from the SSR'd document.
function NavFile({ node, currentPath, slug, version }: NodeProps) {
  const active = node.urlPath === currentPath;
  return (
    <li class="nav-file">
      <a
        class={`nav-link${active ? " nav-link--active" : ""}`}
        href={sitePath(slug, node.urlPath, version)}
      >
        <span class="nav-label">{node.title}</span>
        {node.subtitle && <span class="nav-subtitle">{node.subtitle}</span>}
      </a>
    </li>
  );
}
